// -----------------------------------------------------------------------------
// The Mindwtr hub: reads the sync server on a timer of the container,
// publishes the counters of the device when they change, fires the scene
// events (a task reaches its due date, a task is still open when its due day
// ends, the inbox waits for its review, a task is added), and adds or
// completes tasks for the widget and the scene actions.
//
// Gladys never polls the device (should_poll: false): the interval goes up
// to 10 minutes, beyond the fixed list of the core scheduler, and the scene
// events must fire even when no device was added. The timer also wakes up at
// the next due time, the inbox review time and local midnight, so the events
// and the counters move on time whatever the interval.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { hostOf } from './config.js';
import { buildServer, featureStates, serverIds } from './devices.js';
import { ERROR_KINDS, MindwtrClient, MindwtrError } from './mindwtr/client.js';
import {
  findTask,
  localDay,
  parseContexts,
  parseDone,
  parseDueInput,
  parseProjects,
  parseTasks,
  resolveTimeZone,
  summarize,
  withContext,
} from './mindwtr/model.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  DONE_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  TODAY_TEXT,
  allLanguages,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'mindwtr-hub' });

export const WIDGET_KEY = 'tasks_today';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  DUE: 'task_due',
  OVERDUE: 'task_overdue',
  INBOX_REVIEW: 'inbox_review',
  ADDED: 'task_added',
});

export const HUB_TIMINGS = {
  // A failed read is tried again this soon, whatever the interval.
  retryMs: 30_000,
  // Read this long after a due time or midnight, so the server agrees.
  wakeSlackMs: 2_000,
  // Never read more often than this, even for tasks due a second apart.
  minDelayMs: 10_000,
  // Re-send unchanged values this often: Gladys shows "no recent value" after 48 h.
  heartbeatMs: 12 * 60 * 60_000,
  // An event this late (the server or the integration was down) is dropped.
  maxLateMs: 60 * 60_000,
  // A task created longer ago than this is not "added" (an old one moved back
  // from "done", a sync of a phone offline for days).
  addedWindowMs: 24 * 60 * 60_000,
};

// The reading after a command is awaited at most this long: the scene action
// and the widget button answer within their 20 s.
const REFRESH_WAIT_MS = 3_000;
// Titles read out by the "Read today's tasks" action.
const MAX_TITLES = 10;
// Ids of open tasks remembered under /data, for "task added".
const MAX_KNOWN = 5000;
// A task created from Gladys this recently is Gladys' own (`from_gladys`).
const OWN_CREATION_MS = 30 * 60_000;
// A repeating task's next occurrence appears this soon after the completion.
const FOLLOW_UP_MS = 60_000;

const MAX_TITLE_LENGTH = 500;
const EVENT_TEXT_MAX = 500;

const tokenHash = (token) => createHash('sha256').update(token).digest('hex').slice(0, 16);

/** A home address (private IP, .local, a single label…), else a server on the Internet. */
export function isLocalHost(host) {
  const name = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (/^(localhost|.*\.(local|lan|home|home\.arpa|internal|localdomain))$/.test(name)) {
    return true;
  }
  if (!name.includes('.') && !name.includes(':')) {
    return true;
  }
  const ipv4 = name.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  return name === '::1' || /^f[cd][0-9a-f]{2}:/.test(name) || name.startsWith('fe80:');
}

export class MindwtrHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/mindwtr/http.js)
   * @param {boolean} [options.timers] periodic timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   * @param {string} [options.timeZone] defaults to TZ, set by the Gladys supervisor
   */
  constructor({ gladys, store, request, timers = true, timings, now, timeZone }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.timeZone = resolveTimeZone(timeZone ?? process.env.TZ);
    this.config = null;
    this.client = null;
    this.reset();
    this.saved = { scope: null, readAt: 0, knownIds: [], inboxFiredAt: 0, sentKeys: [] };
    /** Tasks added from Gladys, by id → time: `from_gladys` of "task added". */
    this.ownCreations = new Map();
    this.connection = null;
    this.devicesSignature = null;
    this.widgetSignature = null;
    this.transports = new Map();
    this.timer = null;
    this.polling = null;
    this.stopped = false;
    /** Problems already logged, by key: repeats go to debug. */
    this.warned = new Set();
  }

  reset() {
    /** Open tasks (neither done, archived, deleted nor reference). */
    this.tasks = [];
    this.done = [];
    this.projects = new Map();
    this.error = null;
    this.downSince = null;
    this.readAt = 0;
    this.connectedLogged = false;
  }

  // --- Logs ------------------------------------------------------------------
  // Info keeps the lifecycle only (connected, lost, back, user commands). A
  // problem that repeats is logged once, then at debug until it clears.

  problem(key, message, err, level = 'warn') {
    const args = err === undefined ? [message] : [message, err];
    if (this.warned.has(key)) {
      logger.debug(...args);
      return;
    }
    this.warned.add(key);
    logger[level](...args);
  }

  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  get language() {
    return this.config?.language ?? 'en';
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = {
      scope: typeof saved.scope === 'string' ? saved.scope : null,
      readAt: Number.isFinite(saved.readAt) ? saved.readAt : 0,
      knownIds: Array.isArray(saved.knownIds)
        ? saved.knownIds.filter((id) => typeof id === 'string')
        : [],
      inboxFiredAt: Number.isFinite(saved.inboxFiredAt) ? saved.inboxFiredAt : 0,
      sentKeys: Array.isArray(saved.sentKeys)
        ? saved.sentKeys.filter((key) => typeof key === 'string')
        : [],
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.connection = null;
    this.devicesSignature = null;
    this.transports.clear();
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const same =
      previous &&
      previous.url === config.url &&
      previous.token === config.token &&
      previous.allowSelfSigned === config.allowSelfSigned;
    if (!same) {
      this.reset();
      this.client =
        config.url && config.token
          ? new MindwtrClient({
              url: config.url,
              token: config.token,
              insecure: config.allowSelfSigned,
              request: this.request,
            })
          : null;
    }
    // A new language: the device is published again.
    this.devicesSignature = null;
    this.gladys.forgetPublishedStates?.();
    await this.poll();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.polling?.catch(() => {});
    await this.store.flush();
  }

  schedule(delay) {
    clearTimeout(this.timer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.timer = setTimeout(() => {
      this.poll().catch((err) => this.problem('poll', 'Reading failed', err, 'error'));
    }, delay);
  }

  /** The moment a task is "due": its time, or the start of its day for a date alone. */
  dueMoment(task) {
    return task.allDay ? localDay(task.dueAt, this.timeZone).start : task.dueAt;
  }

  /** When the inbox review event may fire next, null when it cannot. */
  inboxReviewAt() {
    const oldest = this.summary().oldestInbox;
    if (!oldest) {
      return null;
    }
    const reviewMs = this.config.inboxReviewMs;
    const since = this.saved.inboxFiredAt > 0 ? this.saved.inboxFiredAt : oldest.createdAt;
    return since + reviewMs;
  }

  /** The interval, shortened to the next due time, inbox review or local midnight. */
  nextDelay(readAt = this.now()) {
    if (this.error) {
      return Math.min(this.config.pollIntervalMs, this.timings.retryMs);
    }
    const now = this.now();
    // `readAt`: a moment that passed during the reading is still ahead of it.
    const moments = [localDay(readAt, this.timeZone).end];
    for (const task of this.tasks) {
      if (task.dueAt !== null) {
        moments.push(this.dueMoment(task));
      }
    }
    const review = this.inboxReviewAt();
    if (review !== null) {
      moments.push(review);
    }
    const ahead = moments.filter(
      // A moment that passed during a long reading still wakes the next one
      // (minDelayMs keeps it from looping).
      (moment) => moment > readAt,
    );
    const wake =
      ahead.length === 0 ? Infinity : Math.min(...ahead) - now + this.timings.wakeSlackMs;
    return Math.max(this.timings.minDelayMs, Math.min(this.config.pollIntervalMs, wake));
  }

  // --- Reading ---------------------------------------------------------------

  /** One reading at a time: a call during a reading waits for it, then reads. */
  poll() {
    const run = async () => {
      const readAt = this.now();
      try {
        await this.read();
      } finally {
        this.schedule(this.nextDelay(readAt));
      }
    };
    this.polling = (this.polling ?? Promise.resolve()).catch(() => {}).then(run);
    return this.polling;
  }

  async read() {
    if (!this.client) {
      await this.publishConnectionStatus();
      return;
    }
    const now = this.now();
    const { client } = this;
    try {
      const [open, done, projects] = await Promise.all([
        client.openTasks(),
        client.doneTasks(),
        client.projects(),
      ]);
      if (client !== this.client) {
        // The configuration changed during the reading: these are the old
        // server's tasks; the new one is being read.
        return;
      }
      this.tasks = parseTasks(open, this.timeZone);
      this.done = parseDone(done);
      this.projects = parseProjects(projects);
      this.readAt = now;
      if (client.truncated) {
        this.problem(
          'truncated',
          'More than 20000 tasks in a list: the oldest pages only are read',
        );
      }
      this.recovered(now);
    } catch (err) {
      if (client !== this.client) {
        return;
      }
      this.failed(err, now);
    }
    if (this.readAt !== 0) {
      await this.publishDevices();
      if (!this.error) {
        await this.publishStates();
        await this.fireEvents(now);
      }
    }
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.refreshWidget();
  }

  recovered(now) {
    const host = hostOf(this.config.url);
    if (this.downSince !== null) {
      const minutes = Math.round((now - this.downSince) / 60_000);
      this.resolved('read', `Mindwtr at ${host} answers again after ${minutes} min`);
    }
    if (!this.connectedLogged) {
      this.connectedLogged = true;
      logger.info(`Connected to Mindwtr at ${host}: ${this.tasks.length} open task(s)`);
    }
    this.error = null;
    this.downSince = null;
  }

  failed(err, now) {
    const kind = err instanceof MindwtrError ? err.kind : ERROR_KINDS.HTTP;
    this.error = { kind, message: err.message };
    this.downSince ??= now;
    this.problem(
      'read',
      `Mindwtr at ${hostOf(this.config.url)}: ${err.message}`,
      undefined,
      'error',
    );
  }

  summary(tasks = this.tasks) {
    const now = this.now();
    return summarize(tasks, this.done, { now, day: localDay(now, this.timeZone) });
  }

  projectTitle(projectId) {
    return projectId ? (this.projects.get(projectId) ?? '') : '';
  }

  // --- Publishing to Gladys --------------------------------------------------

  devices() {
    return [buildServer(this.gladys, this.language)];
  }

  async publishDevices() {
    const devices = this.devices();
    const signature = JSON.stringify(devices);
    if (signature === this.devicesSignature) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.devicesSignature = signature;
      this.resolved('devices');
    } catch (err) {
      this.problem('devices', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab. */
  async rediscover() {
    this.devicesSignature = null;
    await this.poll();
  }

  /** The user added the device: the states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    this.gladys.forgetPublishedStates?.(device?.external_id);
    if (!this.error && this.readAt !== 0) {
      await this.publishStates();
    }
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  states() {
    const now = this.now();
    return featureStates(serverIds(this.gladys), this.summary(), {
      timeZone: this.timeZone,
      language: this.language,
      day: localDay(now, this.timeZone),
    });
  }

  async publishStates() {
    try {
      // Only the changes, and every value again after `heartbeatMs`.
      await this.gladys.publishChangedStates(this.states(), {
        heartbeat: this.timings.heartbeatMs,
      });
      this.resolved('states');
    } catch (err) {
      this.problem('states', `States refused: ${err.message}`);
    }
  }

  async publishTransports() {
    if (this.readAt === 0) {
      return;
    }
    const reachable = isLocalHost(new URL(this.config.url).hostname)
      ? DEVICE_TRANSPORTS.LOCAL
      : DEVICE_TRANSPORTS.CLOUD;
    const transport = this.error ? DEVICE_TRANSPORTS.UNREACHABLE : reachable;
    const entries = this.devices()
      .map((device) => ({ external_id: device.external_id, transport }))
      .filter((entry) => this.transports.get(entry.external_id) !== entry.transport);
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused: ${err.message}`);
    }
  }

  connectionStatus() {
    if (!this.config.url) {
      return {
        connected: false,
        message: this.config.urlTyped ? CONNECTION_TEXT.invalidUrl : CONNECTION_TEXT.noUrl,
      };
    }
    if (!this.config.token) {
      return { connected: false, message: CONNECTION_TEXT.noToken };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  refreshWidget() {
    const signature = JSON.stringify([
      this.error?.kind ?? null,
      this.tasks,
      [...this.projects],
      localDay(this.now(), this.timeZone).start,
    ]);
    if (signature !== this.widgetSignature) {
      this.widgetSignature = signature;
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  // --- Scene events ----------------------------------------------------------

  save(next) {
    if (JSON.stringify(next) !== JSON.stringify(this.saved)) {
      this.saved = next;
      this.store.save(this.saved);
    }
  }

  /**
   * The moments crossed since the previous successful reading (persisted under
   * /data, so a restart neither repeats nor loses one): a due date, the end of
   * the due day, the inbox review; and the tasks that appeared. A due date
   * moved into the past by hand is not a crossing: nothing fires for it.
   */
  async fireEvents(now) {
    const scope = `${this.config.url}|${tokenHash(this.config.token)}`;
    const openIds = this.tasks.map((task) => task.id);
    const summary = this.summary();
    const reviewMs = this.config.inboxReviewMs;
    if (this.saved.scope !== scope || this.saved.readAt === 0) {
      // First reading of this task list: what already passed is not news.
      const old = summary.oldestInbox && now - summary.oldestInbox.createdAt >= reviewMs;
      this.save({
        scope,
        readAt: now,
        knownIds: openIds.slice(-MAX_KNOWN),
        sentKeys: [],
        inboxFiredAt: old ? now : 0,
      });
      return;
    }
    for (const [id, at] of this.ownCreations) {
      if (now - at > OWN_CREATION_MS) {
        this.ownCreations.delete(id);
      }
    }
    const from = Math.max(this.saved.readAt, now - this.timings.maxLateMs);
    const crossed = (moment) => moment !== null && moment > from && moment <= now;
    const events = [];
    for (const task of this.tasks) {
      if (task.dueAt === null) {
        continue;
      }
      const data = this.eventData(task);
      const due = this.dueMoment(task);
      if (crossed(due)) {
        events.push({ at: due, key: TRIGGERS.DUE, data });
      }
      const dayEnd = localDay(task.dueAt, this.timeZone).end;
      if (crossed(dayEnd)) {
        events.push({ at: dayEnd, key: TRIGGERS.OVERDUE, data });
      }
    }
    events.sort((a, b) => a.at - b.at);

    let readAt = now;
    // Events of the moment where the previous reading stopped, already sent:
    // several all-day tasks share their midnight.
    const sentBefore = new Set(this.saved.sentKeys ?? []);
    let sentKeys = [];
    const sentNow = [];
    for (const { at, key, data } of events) {
      const id = `${key}|${data.task_id}|${at}`;
      if (sentBefore.has(id)) {
        sentNow.push(id);
        continue;
      }
      if (!(await this.fire(key, data))) {
        // Gladys refused (restarting?): this event and the next ones are
        // tried again at the next reading, within the hour.
        readAt = at - 1;
        sentKeys = sentNow.filter((item) => item.endsWith(`|${at}`));
        break;
      }
      sentNow.push(id);
    }

    // Tasks that appeared: new ids, created recently, not the next occurrence
    // of a repeating task just completed.
    const known = new Set(this.saved.knownIds);
    // Done recently: still known, so a task reopened by mistake is not "added".
    const recentDoneIds = this.done
      .filter(
        (task) => task.completedAt !== null && now - task.completedAt <= this.timings.addedWindowMs,
      )
      .map((task) => task.id);
    const unsent = new Set();
    for (const task of this.tasks) {
      if (known.has(task.id)) {
        continue;
      }
      const recent = task.createdAt !== null && now - task.createdAt <= this.timings.addedWindowMs;
      const followUp =
        task.recurring &&
        this.done.some(
          (done) =>
            done.title === task.title &&
            done.completedAt !== null &&
            Math.abs(task.createdAt - done.completedAt) <= FOLLOW_UP_MS,
        );
      if (!recent || followUp) {
        continue;
      }
      const sent = await this.fire(TRIGGERS.ADDED, {
        ...this.eventData(task),
        from_gladys: this.ownCreations.has(task.id),
      });
      if (!sent) {
        unsent.add(task.id);
      }
    }

    // The inbox review: once the oldest item waited N hours, then every N
    // hours while the inbox is not emptied.
    let inboxFiredAt = summary.inbox === 0 ? 0 : this.saved.inboxFiredAt;
    const reviewAt = this.inboxReviewAt();
    if (summary.oldestInbox && reviewAt !== null && reviewAt <= now) {
      const sent = await this.fire(TRIGGERS.INBOX_REVIEW, {
        inbox_count: summary.inbox,
        oldest_task: summary.oldestInbox.title,
        oldest_age_hours: Math.floor((now - summary.oldestInbox.createdAt) / 3_600_000),
      });
      if (sent) {
        inboxFiredAt = now;
      }
    }

    this.save({
      scope,
      readAt: Math.max(readAt, this.saved.readAt),
      knownIds: [...openIds.filter((id) => !unsent.has(id)), ...recentDoneIds].slice(-MAX_KNOWN),
      inboxFiredAt,
      sentKeys,
    });
  }

  eventData(task) {
    return {
      // The SDK refuses a scene event string over 1000 characters: a refused
      // event would be retried, and block the next ones, for an hour.
      task: task.title.slice(0, EVENT_TEXT_MAX),
      task_id: task.id,
      status: task.status,
      contexts: task.contexts.join(' ').slice(0, EVENT_TEXT_MAX),
      project_name: this.projectTitle(task.projectId).slice(0, EVENT_TEXT_MAX),
      due_date: task.dueDate.slice(0, 40),
      all_day: task.allDay,
    };
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.resolved('scene-event');
      return true;
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
      return false;
    }
  }

  // --- Commands --------------------------------------------------------------

  /** A Mindwtr error, in words for the user (the server's text stays in the logs). */
  explain(err) {
    if (!(err instanceof MindwtrError)) {
      return err;
    }
    const language = this.language;
    const colon = language === 'fr' ? ' : ' : ': ';
    const status = err.status ? ` (HTTP ${err.status})` : '';
    return new Error(`Mindwtr${colon}${pick(ERROR_TEXT[err.kind], language)}${status}`, {
      cause: err,
    });
  }

  requireClient() {
    if (!this.client) {
      throw new Error(pick(ACTION_TEXT.notConfigured, this.language));
    }
    return this.client;
  }

  /** Read again now, and wait for it a little (the toast should not lag). */
  async refreshSoon() {
    const refresh = this.poll().catch(() => {});
    let timer;
    await Promise.race([
      refresh,
      new Promise((resolve) => {
        timer = setTimeout(resolve, REFRESH_WAIT_MS);
      }),
    ]);
    clearTimeout(timer);
  }

  /**
   * Mark an open task done, by its title or its id.
   * @param {string} query
   * @param {object} [options]
   * @param {boolean} [options.byId] a widget button: the id of a task the user
   *   saw; not open any more means it was done meanwhile.
   * @returns {Promise<{ task: object }>}
   */
  complete(query, options = {}) {
    // One completion at a time: two taps on the same button would otherwise
    // both find the task open, and complete it twice (a repeating task would
    // get two new occurrences).
    const run = () => this.completeNow(query, options);
    this.completing = (this.completing ?? Promise.resolve()).catch(() => {}).then(run);
    return this.completing;
  }

  async completeNow(query, { byId = false } = {}) {
    const client = this.requireClient();
    let task;
    try {
      // A fresh list: the task may have been added or done a minute ago.
      const open = parseTasks(await client.openTasks(), this.timeZone);
      if (byId) {
        task = open.find((item) => item.id === query) ?? null;
        if (!task) {
          this.poll().catch(() => {});
          throw new Error(pick(ACTION_TEXT.alreadyDone, this.language));
        }
      } else {
        const found = findTask(open, query);
        if (!found.task) {
          const key =
            { empty: 'emptyTask', ambiguous: 'taskAmbiguous' }[found.reason] ?? 'taskNotFound';
          throw new Error(pick(ACTION_TEXT[key], this.language));
        }
        task = found.task;
      }
      await client.complete(task.id);
    } catch (err) {
      throw this.explain(err);
    }
    logger.info('A task was marked done from Gladys');
    await this.refreshSoon();
    return { task };
  }

  /**
   * Add a task to the inbox.
   * @param {{ title: unknown, due?: unknown, context?: unknown }} fields
   * @returns {Promise<{ id: string, title: string, dueDate: string }>}
   */
  async create({ title, due, context }) {
    const client = this.requireClient();
    const wanted = String(title ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!wanted) {
      throw new Error(pick(ACTION_TEXT.emptyTask, this.language));
    }
    const dueDate = parseDueInput(due, { now: this.now(), timeZone: this.timeZone });
    if (dueDate === undefined) {
      throw new Error(pick(ACTION_TEXT.badDueDate, this.language));
    }
    let created;
    try {
      created = await client.createTask({
        title: wanted.slice(0, MAX_TITLE_LENGTH),
        dueDate: dueDate ?? undefined,
        contexts: parseContexts(context),
      });
    } catch (err) {
      throw this.explain(err);
    }
    const id = typeof created?.id === 'string' ? created.id : '';
    if (id) {
      this.ownCreations.set(id, this.now());
    }
    logger.info('A task was added to the inbox from Gladys');
    await this.refreshSoon();
    return { id, title: created?.title ?? wanted, dueDate: dueDate ?? '' };
  }

  /**
   * Today's tasks (overdue included), as a sentence for a message or a voice
   * announcement, for every context or one.
   */
  async today(context) {
    this.requireClient();
    await this.poll();
    if (this.error) {
      throw this.explain(new MindwtrError(this.error.kind, this.error.message));
    }
    const all = this.summary();
    const summary = this.summary(withContext(this.tasks, context));
    const texts = TODAY_TEXT[this.language] ?? TODAY_TEXT.en;
    const titles = summary.today.slice(0, MAX_TITLES).map((task) => task.title);
    const more = summary.today.length - titles.length;
    if (more > 0) {
      titles.push(`+${more}`);
    }
    const text =
      (summary.today.length === 0 ? texts.none : texts.list(summary.today.length, titles)) +
      (summary.overdue > 0 ? texts.overdue(summary.overdue) : '') +
      (all.inbox > 0 ? texts.inbox(all.inbox) : '');
    return {
      text: text.slice(0, 1000),
      count: summary.today.length,
      overdue: summary.overdue,
      inbox: all.inbox,
    };
  }

  /** The toast of a command, in the four languages. */
  static doneMessage(title, kind = 'done') {
    return allLanguages((language) => DONE_TEXT[language][kind](title).slice(0, 200));
  }

  /** The "Test the connection" action: read now, report. */
  async testConnection() {
    await this.poll();
    const status = this.connectionStatus();
    if (!status.connected) {
      const message = allLanguages((language) =>
        REPORT_TEXT[language].failed(pick(status.message, language)),
      );
      throw new Error(message[this.language]);
    }
    const { inbox } = this.summary();
    return allLanguages((language) => REPORT_TEXT[language].ok(this.tasks.length, inbox));
  }
}
