// -----------------------------------------------------------------------------
// Client of the REST API of the Mindwtr sync server (`mindwtr-cloud`), the
// same token as the apps' sync in the `Authorization: Bearer` header. Checked
// against apps/cloud/src/server.ts of dongdongbh/Mindwtr and a real
// ghcr.io/dongdongbh/mindwtr-cloud 1.3.6 in Docker, October 2026.
//
//   GET  /v1/tasks?limit=&offset=          { tasks, total, limit, offset }
//        open tasks: neither done nor archived nor deleted ("reference" included)
//   GET  /v1/tasks?status=done&all=1       the done ones (without `all=1`:
//        always empty, the open filter drops "done" first)
//   GET  /v1/projects                      { projects, total, limit, offset }
//   POST /v1/tasks  { title, props }       201 { task }  (inbox by default)
//   POST /v1/tasks/:id/complete            200 { task }
//
// Never `/v1/data`: it is the whole document the apps synchronize, and a PUT
// replaces it. The task routes above take the server's write lock and merge
// like the apps do (a repeating task completed gets its next occurrence).
//
// Pitfalls found on the real server:
//   - `props.dueDate` is stored as given, without validation ("nope" is
//     accepted): the integration checks it before sending.
//   - `POST /v1/tasks` with `input` runs the quick-add parser (`#tag`,
//     `@context`, `/due:`): a title from a scene could be rewritten. The
//     integration sends `title` and explicit `props` instead.
//   - `/complete` on a task already done completes it again (and a repeating
//     one gets one more occurrence): the integration checks the task is open
//     in a fresh list first.
//   - A list answers at most `limit` items (200 by default, 1000 at most).
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify (self-signed without the option)
  AUTH: 'auth', // a token that is not in MINDWTR_CLOUD_AUTH_TOKENS
  NOT_MINDWTR: 'not_mindwtr', // something answers, but not the Mindwtr API
  REDIRECT: 'redirect', // HTTP redirected to HTTPS, or a login portal
  RATE_LIMIT: 'rate_limit', // 429: the server's request limit
  STORAGE: 'storage', // 503: the server cannot use its data directory
  HTTP: 'http', // any other unexpected answer
});

export class MindwtrError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.name = 'MindwtrError';
    this.kind = kind;
    this.status = status;
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

const PAGE_SIZE = 500;
// 20 000 tasks: the done ones pile up forever on the server.
const MAX_PAGES = 40;

function networkError(err) {
  if (TLS_CODES.has(err.code)) {
    return new MindwtrError(ERROR_KINDS.TLS, `Certificate refused (${err.code})`);
  }
  return new MindwtrError(ERROR_KINDS.UNREACHABLE, err.code ? `${err.code}` : err.message);
}

/** The `error` text of a Mindwtr JSON answer, if any (never echoes a token). */
function errorText(body) {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.error === 'string' ? parsed.error.slice(0, 200) : '';
  } catch {
    return '';
  }
}

export class MindwtrClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL (the apps' "Self-Hosted URL"), without trailing slash
   * @param {string} options.token one of the server's MINDWTR_CLOUD_AUTH_TOKENS
   * @param {boolean} [options.insecure] accept a self-signed certificate
   * @param {Function} [options.request] HTTP seam (src/mindwtr/http.js)
   */
  constructor({ url, token, insecure = false, request = httpRequest }) {
    this.url = url;
    this.token = token;
    this.insecure = insecure;
    this.request = request;
  }

  async call(path, { method = 'GET', json } = {}) {
    let response;
    try {
      response = await this.request(`${this.url}${path}`, {
        method,
        json,
        insecure: this.insecure,
        headers: { authorization: `Bearer ${this.token}` },
      });
    } catch (err) {
      throw networkError(err);
    }
    const { status, body } = response;
    if (status === 401 || status === 403) {
      throw new MindwtrError(ERROR_KINDS.AUTH, `HTTP ${status} ${errorText(body)}`.trim(), status);
    }
    if (status === 429) {
      throw new MindwtrError(ERROR_KINDS.RATE_LIMIT, 'HTTP 429', status);
    }
    if (status >= 300 && status < 400) {
      throw new MindwtrError(ERROR_KINDS.REDIRECT, `HTTP ${status}`, status);
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      // A web page (the PWA, a proxy) on this address.
      throw new MindwtrError(
        status === 200 || status === 404 ? ERROR_KINDS.NOT_MINDWTR : ERROR_KINDS.HTTP,
        `HTTP ${status}, not JSON`,
        status,
      );
    }
    // An unknown route (a wrong path prefix): the server's generic 404, not
    // the "Task not found" of a task route.
    if (status === 404 && !/task not found/i.test(errorText(body))) {
      throw new MindwtrError(ERROR_KINDS.NOT_MINDWTR, `HTTP 404 ${errorText(body)}`.trim(), status);
    }
    if (status === 503) {
      throw new MindwtrError(ERROR_KINDS.STORAGE, `HTTP 503 ${errorText(body)}`.trim(), status);
    }
    if (status < 200 || status >= 300) {
      throw new MindwtrError(ERROR_KINDS.HTTP, `HTTP ${status} ${errorText(body)}`.trim(), status);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new MindwtrError(ERROR_KINDS.NOT_MINDWTR, `HTTP ${status}, not an object`, status);
    }
    return parsed;
  }

  /** Every page of a list (`key`: `tasks`, `projects`). */
  async list(path, key) {
    const items = [];
    const separator = path.includes('?') ? '&' : '?';
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const answer = await this.call(
        `${path}${separator}limit=${PAGE_SIZE}&offset=${items.length}`,
      );
      if (!Array.isArray(answer[key])) {
        throw new MindwtrError(ERROR_KINDS.NOT_MINDWTR, `no "${key}" list`, 200);
      }
      items.push(...answer[key]);
      const total = Number.isInteger(answer.total) ? answer.total : items.length;
      if (answer[key].length === 0 || items.length >= total) {
        return items;
      }
    }
    // Said once by the hub: past this, the counters miss the last tasks.
    this.truncated = true;
    return items;
  }

  /** Tasks neither done nor archived nor deleted. */
  openTasks() {
    return this.list('/v1/tasks', 'tasks');
  }

  doneTasks() {
    return this.list('/v1/tasks?status=done&all=1', 'tasks');
  }

  projects() {
    return this.list('/v1/projects', 'projects');
  }

  /**
   * Add a task to the inbox.
   * @param {{ title: string, dueDate?: string, contexts?: string[] }} task
   * @returns {Promise<object>} the task saved by the server
   */
  async createTask({ title, dueDate, contexts }) {
    const props = { status: 'inbox' };
    if (dueDate) {
      props.dueDate = dueDate;
    }
    if (contexts?.length) {
      props.contexts = contexts;
    }
    const answer = await this.call('/v1/tasks', { method: 'POST', json: { title, props } });
    return answer.task ?? null;
  }

  /** Mark a task done now; a repeating one gets its next occurrence. */
  async complete(id) {
    const answer = await this.call(`/v1/tasks/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
    });
    return answer.task ?? null;
  }
}
