// -----------------------------------------------------------------------------
// An in-memory Mindwtr sync server, answering the routes the integration
// calls the way mindwtr-cloud does (status codes, `{ error }` answers, 401 for
// any other token, `limit`/`offset` pages, "done" left out of the open list,
// a repeating task completed gets its next occurrence, `/complete` on a done
// task completes it again). Its starting data are real answers of
// ghcr.io/dongdongbh/mindwtr-cloud 1.3.6 in Docker (21/10/2026,
// test/fixtures/mindwtr/real-*.json): ten open tasks over the four GTD lists
// plus a reference note, one project, one done task (a daily one, whose next
// occurrence is open).
//
// `/v1/data`, the document the apps synchronize, is answered too, and every
// write to it is recorded: the tests check the integration never sends one.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/mindwtr/${name}.json`, import.meta.url), 'utf8'));

export const TOKEN = 'gladys-test-token-0123456789abcdef';

// What POST /v1/tasks accepts in `props` (a subset of the server's allowlist).
const CREATE_PROPS = new Set(['status', 'dueDate', 'contexts', 'tags', 'projectId', 'recurrence']);
const STATUSES = new Set(['inbox', 'next', 'waiting', 'someday', 'reference', 'done', 'archived']);

const json = (status, value) => ({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(value),
});
const error = (status, message) => json(status, { error: message });

function page(key, items, search) {
  const limit = Math.min(1000, Number(search.get('limit') ?? 200));
  const offset = Number(search.get('offset') ?? 0);
  if (!Number.isFinite(limit) || limit <= 0) {
    return error(400, 'Invalid limit');
  }
  return json(200, {
    [key]: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  });
}

const addDay = (date) => {
  const [day, time] = date.split('T');
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return `${next.toISOString().slice(0, 10)}${time ? `T${time}` : ''}`;
};

export class FakeMindwtr {
  constructor({ now = () => Date.now(), token = TOKEN } = {}) {
    this.now = now;
    this.token = token;
    this.tasks = [
      ...structuredClone(fixture('real-tasks-done').tasks),
      ...structuredClone(fixture('real-tasks-open').tasks),
    ];
    this.projects = structuredClone(fixture('real-projects').projects);
    this.online = true;
    this.requests = [];
    this.dataWrites = 0;
    /** Answer this status to every authenticated request (503, 429…). */
    this.failWith = null;
  }

  iso() {
    return new Date(this.now()).toISOString();
  }

  task(id) {
    return this.tasks.find((task) => task.id === id);
  }

  /** A task added by an app (the "sync" of a phone), returned for the tests. */
  add(title, props = {}) {
    const at = this.iso();
    const task = {
      id: randomUUID(),
      title,
      status: 'inbox',
      tags: [],
      contexts: [],
      rev: 1,
      revBy: 'phone',
      createdAt: at,
      updatedAt: at,
      ...props,
    };
    this.tasks.push(task);
    return task;
  }

  /** Mark a task done the way the server does (a repeating one gets a follow-up). */
  markDone(task) {
    const at = this.iso();
    Object.assign(task, { status: 'done', completedAt: at, updatedAt: at, rev: task.rev + 1 });
    if (task.recurrence && task.dueDate) {
      this.tasks.push({
        ...structuredClone(task),
        id: randomUUID(),
        status: 'next',
        dueDate: addDay(task.dueDate),
        completedAt: undefined,
        createdAt: at,
        rev: 1,
      });
    }
  }

  handle(url, { method = 'GET', headers = {}, json: body } = {}) {
    const { pathname, searchParams } = new URL(url);
    this.requests.push({ method, path: pathname, search: searchParams.toString() });
    if (pathname === '/health') {
      return json(200, { ok: true });
    }
    if (!pathname.startsWith('/v1/')) {
      // The PWA (mindwtr-app) on this address.
      return { status: 200, headers: { 'content-type': 'text/html' }, body: '<!doctype html>' };
    }
    if (headers.authorization !== `Bearer ${this.token}`) {
      return error(401, 'Unauthorized');
    }
    if (this.failWith) {
      return error(this.failWith, 'Cloud storage unavailable');
    }
    const complete = pathname.match(/^\/v1\/tasks\/([^/]+)\/complete$/);

    if (pathname === '/v1/data') {
      if (method !== 'GET' && method !== 'HEAD') {
        this.dataWrites += 1;
      }
      return json(200, { tasks: this.tasks, projects: this.projects, settings: {} });
    }
    if (method === 'GET' && pathname === '/v1/tasks') {
      const all = searchParams.get('all') === '1';
      const status = searchParams.get('status');
      if (status !== null && !STATUSES.has(status)) {
        return error(400, 'Invalid task status');
      }
      const items = this.tasks.filter(
        (task) =>
          !task.deletedAt &&
          (all || (task.status !== 'done' && task.status !== 'archived')) &&
          (status === null || task.status === status),
      );
      return page('tasks', items, searchParams);
    }
    if (method === 'POST' && pathname === '/v1/tasks') {
      const props = body?.props ?? {};
      const invalid = Object.keys(props).filter((key) => !CREATE_PROPS.has(key));
      if (invalid.length > 0) {
        return error(400, `Unsupported task props: ${invalid.join(', ')}`);
      }
      if (typeof body?.title !== 'string' || body.title.trim() === '') {
        return error(400, 'Missing task title');
      }
      const task = this.add(body.title, { ...props, revBy: 'cloud' });
      return json(201, { task });
    }
    if (method === 'POST' && complete) {
      const task = this.tasks.find((item) => item.id === complete[1] && !item.deletedAt);
      if (!task) {
        return error(404, 'Task not found');
      }
      this.markDone(task);
      return json(200, { task });
    }
    if (method === 'GET' && pathname === '/v1/projects') {
      return page(
        'projects',
        this.projects.filter((project) => !project.deletedAt),
        searchParams,
      );
    }
    return error(405, 'Method not allowed');
  }
}

/** The network: one fake server per base URL; anything else does not answer. */
export function createNetwork(servers) {
  return {
    servers,
    async request(url, options = {}) {
      const base = Object.keys(servers).find((origin) => url.startsWith(`${origin}/`));
      const server = base ? servers[base] : null;
      if (!server || !server.online) {
        const failure = new Error('connect ECONNREFUSED');
        failure.code = 'ECONNREFUSED';
        throw failure;
      }
      return server.handle(url, options);
    },
  };
}
