// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One Mindwtr sync server (`mindwtr-cloud`, its address and one of the tokens
// of MINDWTR_CLOUD_AUTH_TOKENS: each token is its own task list), read on a
// timer of the container.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['60', '120', '300', '600'];

// Delays offered for the inbox review event, in hours.
export const INBOX_REVIEW_HOURS = ['4', '12', '24', '48', '72', '168'];

export const DEFAULT_CONFIG = {
  url: '',
  api_token: '',
  inbox_review_hours: '24',
  allow_self_signed: false,
  poll_interval: '300',
  language: 'fr',
};

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10:8787`), or the address copied from the app (the "Self-Hosted
 * URL", or the same with `/v1/data` or `/v1`). HTTP by default. A path
 * prefix is kept (behind a reverse proxy under `/mindwtr`).
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/prefix]`, null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs.
  if (url.username || url.password) {
    return null;
  }
  const path = url.pathname
    .replace(/\/v1(\/.*)?$/, '')
    .replace(/\/(health|ready)$/, '')
    .replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

const bool = (value) => value === true || value === 'true';

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const typed = typeof source.url === 'string' ? source.url.trim() : '';
  const poll = String(source.poll_interval ?? '');
  const review = String(source.inbox_review_hours ?? '');
  return {
    url: parseServerUrl(typed),
    urlTyped: typed !== '',
    // Tokens are kept as typed, minus the blanks a copy and paste adds around them.
    token: typeof source.api_token === 'string' ? source.api_token.trim() : '',
    inboxReviewMs:
      Number(INBOX_REVIEW_HOURS.includes(review) ? review : DEFAULT_CONFIG.inbox_review_hours) *
      3_600_000,
    allowSelfSigned: bool(source.allow_self_signed),
    pollIntervalMs:
      Number(POLL_INTERVALS.includes(poll) ? poll : DEFAULT_CONFIG.poll_interval) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
