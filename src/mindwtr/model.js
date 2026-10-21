// -----------------------------------------------------------------------------
// From the raw Mindwtr answers to what Gladys shows: tasks with their due
// time in milliseconds, and the counters of a local day (the time zone of
// Gladys, injected by the supervisor as TZ).
//
// Mindwtr writes a due date as the apps typed it, without a time zone: a
// date (`2026-10-21`, due by the end of that day, like the apps read it) or a
// local date and time (`2026-10-21T19:00`). Both are read in the time zone of
// Gladys, the one of the home.
//
// Definitions, the same in the device, the widget, the scene actions and the
// documentation:
//   - open: neither done nor archived nor deleted, and not "reference"
//     (a reference note is not something to do);
//   - overdue: an open task whose due time has passed (a date: from the
//     next midnight on);
//   - due today: an open task due on today's local date;
//   - next due date: the open task with the earliest due time still ahead.
// -----------------------------------------------------------------------------

export const STATUSES = Object.freeze(['inbox', 'next', 'waiting', 'someday']);

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const instant = (value) => {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : null;
};

// --- Local days -------------------------------------------------------------------

const partsFormatters = new Map();

function zonedParts(ms, timeZone) {
  let format = partsFormatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    partsFormatters.set(timeZone, format);
  }
  return Object.fromEntries(
    format.formatToParts(new Date(ms)).map(({ type, value }) => [type, Number(value)]),
  );
}

/** Offset of `timeZone` from UTC at `ms`, in milliseconds. */
function offsetAt(ms, timeZone) {
  const p = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** UTC instant of a local wall time (DST-safe: a skipped time moves forward). */
export function zonedTime(year, month, day, hour, minute, second, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = guess - offsetAt(guess, timeZone);
  return guess - offsetAt(first, timeZone);
}

/** UTC instant of local midnight of a local calendar day (DST-safe). */
function localMidnight(year, month, day, timeZone) {
  let start = zonedTime(year, month, day, 0, 0, 0, timeZone);
  // Where the clocks jump at midnight (Chile, Cuba), 00:00 does not exist and
  // the instant found is 23:00 the day before: the day starts an hour later.
  if (zonedParts(start, timeZone).day !== day) {
    start += 60 * 60_000;
  }
  return start;
}

/** A time zone Intl knows, else the one of the process. */
export function resolveTimeZone(timeZone) {
  try {
    if (timeZone) {
      new Intl.DateTimeFormat('en-US', { timeZone });
      return timeZone;
    }
  } catch {
    // fall through
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Start and end (exclusive) of the local day holding `now`. */
export function localDay(now, timeZone) {
  const p = zonedParts(now, timeZone);
  const start = localMidnight(p.year, p.month, p.day, timeZone);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  const end = localMidnight(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timeZone,
  );
  return { start, end };
}

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?)?$/;

const validDate = (year, month, day) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

/**
 * A Mindwtr due date in milliseconds: the due time, or, for a date alone, the
 * last millisecond of that local day (the apps read it as "by tonight").
 * @param {unknown} value
 * @param {string} timeZone
 * @returns {{ at: number, allDay: boolean }|null} null when absent or unreadable
 */
export function parseDueDate(value, timeZone) {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const raw = value.trim();
  const match = DATE_TIME.exec(raw);
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (!validDate(year, month, day)) {
      return null;
    }
    if (match[4] === undefined) {
      const next = new Date(Date.UTC(year, month - 1, day + 1));
      const end = localMidnight(
        next.getUTCFullYear(),
        next.getUTCMonth() + 1,
        next.getUTCDate(),
        timeZone,
      );
      return { at: end - 1, allDay: true };
    }
    const [hour, minute, second] = [Number(match[4]), Number(match[5]), Number(match[6] ?? 0)];
    if (hour > 23 || minute > 59 || second > 59) {
      return null;
    }
    return { at: zonedTime(year, month, day, hour, minute, second, timeZone), allDay: false };
  }
  // With an explicit offset or Z: an instant.
  if (/T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const at = instant(raw);
    return at === null ? null : { at, allDay: false };
  }
  return null;
}

/**
 * Open tasks, sorted by due time (undated last), then title.
 * @param {unknown[]} raw tasks of GET /v1/tasks
 * @param {string} timeZone
 * @returns {Array<{ id: string, title: string, status: string, dueAt: number|null,
 *   allDay: boolean, dueDate: string, contexts: string[], projectId: string,
 *   createdAt: number|null, recurring: boolean }>}
 */
export function parseTasks(raw, timeZone) {
  return (Array.isArray(raw) ? raw : [])
    .filter((task) => task && typeof task.id === 'string' && task.id !== '')
    .filter((task) => STATUSES.includes(task.status) && !task.deletedAt)
    .map((task) => {
      const due = parseDueDate(task.dueDate, timeZone);
      return {
        id: task.id,
        title: text(task.title) || '?',
        status: task.status,
        dueAt: due?.at ?? null,
        allDay: due?.allDay ?? false,
        dueDate: due ? task.dueDate.trim() : '',
        contexts: (Array.isArray(task.contexts) ? task.contexts : [])
          .filter((context) => typeof context === 'string' && context.trim() !== '')
          .map((context) => context.trim()),
        projectId: typeof task.projectId === 'string' ? task.projectId : '',
        createdAt: instant(task.createdAt),
        recurring: Boolean(task.recurrence),
      };
    })
    .sort(
      (a, b) =>
        (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id),
    );
}

/**
 * Done tasks: id, title and completion time.
 * @param {unknown[]} raw tasks of GET /v1/tasks?status=done&all=1
 */
export function parseDone(raw) {
  return (Array.isArray(raw) ? raw : [])
    .filter((task) => task && typeof task.id === 'string' && task.status === 'done')
    .filter((task) => !task.deletedAt)
    .map((task) => ({
      id: task.id,
      title: text(task.title) || '?',
      completedAt: instant(task.completedAt),
    }));
}

/** @returns {Map<string, string>} project id → title (deleted ones left out) */
export function parseProjects(raw) {
  return new Map(
    (Array.isArray(raw) ? raw : [])
      .filter((project) => project && typeof project.id === 'string' && !project.deletedAt)
      .map((project) => [project.id, text(project.title) || '?']),
  );
}

// --- Counters ---------------------------------------------------------------------

const foldContext = (value) => fold(String(value ?? '').replace(/^@/, ''));

/** The tasks carrying a context (`@home` or `home`); every task when empty. */
export function withContext(tasks, context) {
  const wanted = foldContext(context);
  if (!wanted) {
    return tasks;
  }
  return tasks.filter((task) => task.contexts.some((item) => foldContext(item) === wanted));
}

/**
 * The counters of the device and the widget.
 * @param {ReturnType<typeof parseTasks>} tasks
 * @param {ReturnType<typeof parseDone>} done
 * @param {{ now: number, day: { start: number, end: number } }} options
 */
export function summarize(tasks, done, { now, day }) {
  const dated = tasks.filter((task) => task.dueAt !== null);
  const inbox = tasks.filter((task) => task.status === 'inbox');
  return {
    inbox: inbox.length,
    next: tasks.filter((task) => task.status === 'next').length,
    waiting: tasks.filter((task) => task.status === 'waiting').length,
    overdue: dated.filter((task) => task.dueAt < now).length,
    dueToday: dated.filter((task) => task.dueAt >= day.start && task.dueAt < day.end).length,
    doneToday: done.filter((task) => task.completedAt !== null && task.completedAt >= day.start)
      .length,
    nextDue: dated.find((task) => task.dueAt >= now) ?? null,
    // What is left by tonight: overdue first (the list is sorted by due time).
    today: dated.filter((task) => task.dueAt < day.end),
    oldestInbox: inbox.reduce(
      (oldest, task) =>
        task.createdAt !== null && (oldest === null || task.createdAt < oldest.createdAt)
          ? task
          : oldest,
      null,
    ),
  };
}

const fold = (value) =>
  String(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Find an open task by its id (the UUID Mindwtr gives) or its exact title
 * (case, accents and repeated blanks ignored).
 * @template {{ id: string, title: string }} T
 * @param {T[]} tasks
 * @param {unknown} query
 * @returns {{ task: T|null, reason?: 'empty'|'not_found'|'ambiguous' }}
 */
export function findTask(tasks, query) {
  const wanted = String(query ?? '').trim();
  if (!wanted) {
    return { task: null, reason: 'empty' };
  }
  if (UUID.test(wanted)) {
    const byId = tasks.find((task) => task.id.toLowerCase() === wanted.toLowerCase());
    if (byId) {
      return { task: byId };
    }
  }
  const matches = tasks.filter((task) => fold(task.title) === fold(wanted));
  if (matches.length === 1) {
    return { task: matches[0] };
  }
  return { task: null, reason: matches.length > 1 ? 'ambiguous' : 'not_found' };
}

// --- Due dates typed in a scene -----------------------------------------------------

const TODAY_WORDS = new Set(['today', "aujourd'hui", 'aujourdhui', 'heute', 'hoy']);
const TOMORROW_WORDS = new Set(['tomorrow', 'demain', 'morgen', 'manana']);

const pad = (number) => String(number).padStart(2, '0');

/**
 * A due date typed in the scene action, in the format the Mindwtr apps write:
 * `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM` (local time, no zone).
 *
 * Accepted: `2026-10-25`, `25/10/2026`, `25.10.2026`, `25/10` (the next such
 * day), `today` / `tomorrow` (and aujourd'hui / demain, heute / morgen,
 * hoy / mañana), each optionally followed by a time `18:30` or `18h30`.
 * @param {unknown} value
 * @param {{ now: number, timeZone: string }} options
 * @returns {string|null|undefined} the date, null when empty, undefined when unreadable
 */
export function parseDueInput(value, { now, timeZone }) {
  const raw = fold(value ?? '').replace(/’/g, "'");
  if (!raw) {
    return null;
  }
  // `t` closes an ISO date (folded to lower case), the others a word.
  const timeMatch = raw.match(/(?:^|[\s,t])(\d{1,2})(?::|h)(\d{2})?$/);
  let time = '';
  let datePart = raw;
  if (timeMatch) {
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2] ?? 0);
    if (hour > 23 || minute > 59) {
      return undefined;
    }
    time = `T${pad(hour)}:${pad(minute)}`;
    // "demain à 18h", "tomorrow at 6:30", "morgen um 18:00", "mañana a las 18:00".
    datePart = raw
      .slice(0, timeMatch.index)
      .replace(/,$/, '')
      .trim()
      .replace(/(^|\s)(a|at|um|a las)$/, '')
      .trim();
  }
  const today = zonedParts(now, timeZone);
  let year;
  let month;
  let day;
  if (datePart === '' && time) {
    // A time alone: today, or tomorrow when it has already passed.
    const passed = time <= `T${pad(today.hour)}:${pad(today.minute)}`;
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + (passed ? 1 : 0)));
    [year, month, day] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  } else if (TODAY_WORDS.has(datePart) || TOMORROW_WORDS.has(datePart)) {
    const shift = TOMORROW_WORDS.has(datePart) ? 1 : 0;
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + shift));
    [year, month, day] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  } else {
    const iso = datePart.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const european = datePart.match(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{4}))?$/);
    if (iso) {
      [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    } else if (european) {
      [day, month] = [Number(european[1]), Number(european[2])];
      year = european[3] ? Number(european[3]) : today.year;
      if (!european[3] && (month < today.month || (month === today.month && day < today.day))) {
        year += 1;
      }
    } else {
      return undefined;
    }
  }
  if (!validDate(year, month, day)) {
    return undefined;
  }
  return `${year}-${pad(month)}-${pad(day)}${time}`;
}

/**
 * Contexts typed in the scene action: `@home`, `home`, or several separated
 * by commas or blanks. Mindwtr writes them with their `@`.
 * @returns {string[]}
 */
export function parseContexts(value) {
  return [
    ...new Set(
      String(value ?? '')
        .split(/[,;\s]+/)
        .map((item) => item.trim().replace(/^@+/, ''))
        .filter(Boolean)
        .map((item) => `@${item}`.slice(0, 50)),
    ),
  ].slice(0, 10);
}
