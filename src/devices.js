// -----------------------------------------------------------------------------
// The Gladys device: one per configured server ("Mindwtr"), its GTD counters
// and the next due date.
//
// Identity: `server` / `main`. The integration follows one server and one
// token: changing the address or the token (a move, a new token) keeps the
// device, its history, its scenes and its dashboards.
//
// Features (category/type couples of the core table, test/gladys-rules.test.js),
// definitions in src/mindwtr/model.js:
//   - inbox, next actions, waiting for, overdue, due today, done today:
//     counter-sensor/integer;
//   - next due date: text/text, "title · when" ("None" when nothing is
//     planned: a text state is never empty).
//
// The device is published with should_poll: false: the integration reads
// the server on its own timer (src/hub.js), every 1 to 10 minutes.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

export const SERVER_TYPE = 'server';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  INBOX: 'inbox',
  NEXT: 'next_actions',
  WAITING: 'waiting',
  OVERDUE: 'overdue',
  DUE_TODAY: 'due_today',
  DONE_TODAY: 'done_today',
  NEXT_DUE: 'next_due',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.INBOX]: 'Tasks in the inbox',
    [FEATURE_KEYS.NEXT]: 'Next actions',
    [FEATURE_KEYS.WAITING]: 'Waiting for',
    [FEATURE_KEYS.OVERDUE]: 'Overdue tasks',
    [FEATURE_KEYS.DUE_TODAY]: 'Tasks due today',
    [FEATURE_KEYS.DONE_TODAY]: 'Tasks done today',
    [FEATURE_KEYS.NEXT_DUE]: 'Next due date',
  },
  fr: {
    [FEATURE_KEYS.INBOX]: 'Tâches dans la boîte de réception',
    [FEATURE_KEYS.NEXT]: 'Prochaines actions',
    [FEATURE_KEYS.WAITING]: 'En attente',
    [FEATURE_KEYS.OVERDUE]: 'Tâches en retard',
    [FEATURE_KEYS.DUE_TODAY]: "Tâches dues aujourd'hui",
    [FEATURE_KEYS.DONE_TODAY]: "Tâches terminées aujourd'hui",
    [FEATURE_KEYS.NEXT_DUE]: 'Prochaine échéance',
  },
  de: {
    [FEATURE_KEYS.INBOX]: 'Aufgaben im Eingang',
    [FEATURE_KEYS.NEXT]: 'Nächste Schritte',
    [FEATURE_KEYS.WAITING]: 'Wartet auf',
    [FEATURE_KEYS.OVERDUE]: 'Überfällige Aufgaben',
    [FEATURE_KEYS.DUE_TODAY]: 'Heute fällige Aufgaben',
    [FEATURE_KEYS.DONE_TODAY]: 'Heute erledigte Aufgaben',
    [FEATURE_KEYS.NEXT_DUE]: 'Nächste Fälligkeit',
  },
  es: {
    [FEATURE_KEYS.INBOX]: 'Tareas en la bandeja de entrada',
    [FEATURE_KEYS.NEXT]: 'Próximas acciones',
    [FEATURE_KEYS.WAITING]: 'En espera',
    [FEATURE_KEYS.OVERDUE]: 'Tareas atrasadas',
    [FEATURE_KEYS.DUE_TODAY]: 'Tareas para hoy',
    [FEATURE_KEYS.DONE_TODAY]: 'Tareas terminadas hoy',
    [FEATURE_KEYS.NEXT_DUE]: 'Próximo vencimiento',
  },
};

// Published on "next due date" when no open task has a due date ahead.
export const NO_TASK = { en: 'None', fr: 'Aucune', de: 'Keine', es: 'Ninguna' };

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

// Display bounds (the core never applies them on write).
const COUNTER_MAX = 10000;
const TEXT_MAX_LENGTH = 100;

const counter = (key, value) => ({
  key,
  definition: {
    category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    min: 0,
    max: COUNTER_MAX,
  },
  value,
});

/**
 * When a task is due, short, in the language and the time zone of Gladys:
 * its time when due today, else its day (and time, if it has one).
 */
export function formatDue(task, { timeZone, language, day }) {
  const locale = LOCALES[language] ?? LOCALES.en;
  const today = task.dueAt >= day.start && task.dueAt < day.end;
  const options = today
    ? { hour: '2-digit', minute: '2-digit' }
    : {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        ...(task.allDay ? {} : { hour: '2-digit', minute: '2-digit' }),
      };
  if (today && task.allDay) {
    return { en: 'today', fr: "aujourd'hui", de: 'heute', es: 'hoy' }[language] ?? 'today';
  }
  return new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(new Date(task.dueAt));
}

// Order = display order in Gladys.
const FEATURES = [
  counter(FEATURE_KEYS.INBOX, (summary) => summary.inbox),
  counter(FEATURE_KEYS.NEXT, (summary) => summary.next),
  counter(FEATURE_KEYS.WAITING, (summary) => summary.waiting),
  counter(FEATURE_KEYS.OVERDUE, (summary) => summary.overdue),
  counter(FEATURE_KEYS.DUE_TODAY, (summary) => summary.dueToday),
  counter(FEATURE_KEYS.DONE_TODAY, (summary) => summary.doneToday),
  {
    key: FEATURE_KEYS.NEXT_DUE,
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
      read_only: true,
      has_feedback: false,
      keep_history: false,
      // NOT NULL in the core, even for a text (422 on "Add to Gladys" otherwise).
      min: 0,
      max: 0,
    },
    value: (summary, context) => {
      if (!summary.nextDue) {
        return NO_TASK[context.language] ?? NO_TASK.en;
      }
      const when = formatDue(summary.nextDue, context);
      const title = summary.nextDue.title.slice(0, TEXT_MAX_LENGTH - when.length - 3);
      return `${title} · ${when}`;
    },
  },
];

export const serverIds = (gladys) => gladys.externalIds(SERVER_TYPE, 'main');

export function buildServer(gladys, language = 'en') {
  const ids = serverIds(gladys);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: 'Mindwtr',
    external_id: ids.device,
    should_poll: false,
    features: FEATURES.map(({ key, definition }) => ({
      ...definition,
      name: names[key],
      external_id: ids.feature(key),
    })),
  };
}

/**
 * The states of every feature for a summary (src/mindwtr/model.js), in the
 * `publishStates` format: `state` for a number, `text` for a text.
 * @param {object} ids serverIds()
 * @param {object} summary
 * @param {{ now: number, timeZone: string, language: string, day: object }} context
 * @returns {Array<{ device_feature_external_id: string, state?: number, text?: string }>}
 */
export function featureStates(ids, summary, context) {
  return FEATURES.map(({ key, value }) =>
    key === FEATURE_KEYS.NEXT_DUE
      ? { device_feature_external_id: ids.feature(key), text: value(summary, context) }
      : { device_feature_external_id: ids.feature(key), state: value(summary) },
  );
}
