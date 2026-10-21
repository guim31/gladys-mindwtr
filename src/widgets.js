// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `tasks_today`.
//
// The use case: the kitchen tablet shows what is due today and what is late,
// and a tap marks a task done without opening Mindwtr.
//
// Budget (8 components, 2 texts): two tiles (due today, overdue), one status
// list (overdue first, with their time and context) and a "done" button for
// each of the four most urgent ones. Nothing left: a sentence and the next
// due date. The figures are values, not bound to device features, so the
// widget works before the device is added.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { formatDue } from './devices.js';
import { MindwtrHub, WIDGET_KEY } from './hub.js';
import { localDay } from './mindwtr/model.js';
import { pick } from './texts.js';

// Action keys of the buttons: permanent once published (unique, the core
// drops a button whose key is taken).
export const DONE_ACTIONS = ['done_1', 'done_2', 'done_3', 'done_4'];
const MAX_ROWS = 10;

export const TEXT = {
  configure: {
    en: 'Enter the address of your Mindwtr sync server and its token in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre serveur de synchronisation Mindwtr et son jeton dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines Mindwtr-Sync-Servers und sein Token in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su servidor de sincronización Mindwtr y su token en la configuración de la integración.',
  },
  noAnswer: {
    en: 'Mindwtr does not answer: see the Configuration screen of the integration.',
    fr: "Mindwtr ne répond pas : voir l'écran Configuration de l'intégration.",
    de: 'Mindwtr antwortet nicht: Sieh dir die Konfiguration der Integration an.',
    es: 'Mindwtr no responde: consulte la pantalla de configuración de la integración.',
  },
  stale: {
    en: 'Mindwtr does not answer: last known tasks.',
    fr: 'Mindwtr ne répond pas : dernières tâches connues.',
    de: 'Mindwtr antwortet nicht: zuletzt bekannte Aufgaben.',
    es: 'Mindwtr no responde: últimas tareas conocidas.',
  },
  nothing: {
    en: 'Nothing left for today.',
    fr: "Plus rien pour aujourd'hui.",
    de: 'Für heute ist nichts mehr übrig.',
    es: 'No queda nada para hoy.',
  },
  dueToday: { en: 'Due today', fr: "Aujourd'hui", de: 'Heute fällig', es: 'Para hoy' },
  overdue: { en: 'Overdue', fr: 'En retard', de: 'Überfällig', es: 'Atrasadas' },
  next: { en: 'Next', fr: 'Prochaine', de: 'Nächste', es: 'Próxima' },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

/** The status row of a task: overdue, or when it is due; and its contexts. */
function taskRow(task, { now, context }) {
  const late = task.dueAt < now;
  const when = late ? t(TEXT.overdue, context.language) : formatDue(task, context);
  const where = task.contexts.join(' ');
  return {
    label: fit(task.title, 40),
    icon: late ? 'alert-circle' : task.status === 'waiting' ? 'pause-circle' : 'clock',
    value: fit(where ? `${when} · ${where}` : when, 40),
    color: late ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
  };
}

async function get(hub, { language = 'en' }) {
  if (!hub.client) {
    return message(TEXT.configure, language);
  }
  if (hub.error && hub.readAt === 0) {
    return message(TEXT.noAnswer, language);
  }
  const now = hub.now();
  const context = { timeZone: hub.timeZone, language, day: localDay(now, hub.timeZone) };
  const summary = hub.summary();
  const components = [];
  if (hub.error) {
    components.push({ type: 'text', variant: 'caption', text: t(TEXT.stale, language) });
  }
  components.push(
    {
      type: 'value',
      value: summary.dueToday,
      label: t(TEXT.dueToday, language),
      icon: 'calendar',
    },
    {
      type: 'value',
      value: summary.overdue,
      label: t(TEXT.overdue, language),
      icon: 'alert-circle',
      color: summary.overdue > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    },
  );
  if (summary.today.length === 0) {
    components.push({ type: 'text', variant: 'body', text: t(TEXT.nothing, language) });
    if (summary.nextDue) {
      components.push({
        type: 'status',
        items: [
          {
            label: fit(summary.nextDue.title, 40),
            icon: 'calendar',
            value: fit(`${t(TEXT.next, language)} · ${formatDue(summary.nextDue, context)}`, 40),
            color: WIDGET_COLORS.NEUTRAL,
          },
        ],
      });
    }
    return { ttl_seconds: 300, components };
  }
  components.push({
    type: 'status',
    items: summary.today.slice(0, MAX_ROWS).map((task) => taskRow(task, { now, context })),
  });
  if (!hub.error) {
    // The id travels with the button: Mindwtr gives each occurrence of a
    // repeating task its own id, so a tap on a stale widget finds the task
    // done and completes nothing.
    summary.today.slice(0, DONE_ACTIONS.length).forEach((task, index) => {
      components.push({
        type: 'button',
        label: fit(task.title, 24),
        icon: 'check',
        style: 'secondary',
        action: { key: DONE_ACTIONS[index], params: { id: task.id } },
      });
    });
  }
  return { ttl_seconds: 300, components };
}

async function action(hub, { actionKey, params = {} }) {
  if (!DONE_ACTIONS.includes(actionKey) || typeof params.id !== 'string' || !params.id) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  const { task } = await hub.complete(params.id, { byId: true });
  return { message: MindwtrHub.doneMessage(task.title) };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
