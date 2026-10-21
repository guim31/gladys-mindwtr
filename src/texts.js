// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, scene action
// errors and results. Four languages, the four of the Gladys interface;
// German says "du", Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './mindwtr/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of your Mindwtr sync server in the configuration.',
    fr: "Saisissez l'adresse de votre serveur de synchronisation Mindwtr dans la configuration.",
    de: 'Gib die Adresse deines Mindwtr-Sync-Servers in der Konfiguration ein.',
    es: 'Introduzca la dirección de su servidor de sincronización Mindwtr en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.20:8787',
    fr: 'Adresse incomprise, ex. http://192.168.1.20:8787',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.20:8787',
    es: 'Dirección no válida, p. ej. http://192.168.1.20:8787',
  },
  noToken: {
    en: 'Enter the sync token of Mindwtr in the configuration (MINDWTR_CLOUD_AUTH_TOKENS).',
    fr: 'Saisissez le jeton de synchronisation de Mindwtr dans la configuration (MINDWTR_CLOUD_AUTH_TOKENS).',
    de: 'Gib das Sync-Token von Mindwtr in der Konfiguration ein (MINDWTR_CLOUD_AUTH_TOKENS).',
    es: 'Introduzca el token de sincronización de Mindwtr en la configuración (MINDWTR_CLOUD_AUTH_TOKENS).',
  },
};

// One short explanation per error kind (src/mindwtr/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'the sync server does not answer',
    fr: 'le serveur de synchronisation ne répond pas',
    de: 'der Sync-Server antwortet nicht',
    es: 'el servidor de sincronización no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept self-signed certificates"',
    fr: 'certificat refusé : cochez « Accepter les certificats auto-signés »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'token refused: use the token of the sync settings of the app',
    fr: "jeton refusé : utilisez celui des réglages de synchronisation de l'appli",
    de: 'Token abgelehnt: Nutze das Token aus den Sync-Einstellungen der App',
    es: 'token rechazado: use el de los ajustes de sincronización de la aplicación',
  },
  [ERROR_KINDS.NOT_MINDWTR]: {
    en: 'no Mindwtr sync server at this address (port 8787, not the web app)',
    fr: "aucun serveur de synchronisation Mindwtr à cette adresse (port 8787, pas l'appli web)",
    de: 'kein Mindwtr-Sync-Server unter dieser Adresse (Port 8787, nicht die Web-App)',
    es: 'no hay servidor de sincronización Mindwtr en esta dirección (puerto 8787, no la aplicación web)',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.RATE_LIMIT]: {
    en: 'too many requests, retrying later',
    fr: 'trop de requêtes, nouvel essai plus tard',
    de: 'zu viele Anfragen, neuer Versuch später',
    es: 'demasiadas solicitudes, se reintentará más tarde',
  },
  [ERROR_KINDS.STORAGE]: {
    en: 'the server cannot use its data folder, see its logs',
    fr: 'le serveur ne peut pas utiliser son dossier de données, voir ses logs',
    de: 'der Server kann seinen Datenordner nicht nutzen, sieh in seinen Protokollen nach',
    es: 'el servidor no puede usar su carpeta de datos, consulte sus registros',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: (open, inbox) => `Mindwtr OK: ${open} open task(s), ${inbox} in the inbox.`,
    failed: (reason) => `Mindwtr: ${reason}.`,
  },
  fr: {
    ok: (open, inbox) =>
      `Mindwtr OK : ${open} tâche(s) ouverte(s), ${inbox} dans la boîte de réception.`,
    failed: (reason) => `Mindwtr : ${reason}.`,
  },
  de: {
    ok: (open, inbox) => `Mindwtr OK: ${open} offene Aufgabe(n), ${inbox} im Eingang.`,
    failed: (reason) => `Mindwtr: ${reason}.`,
  },
  es: {
    ok: (open, inbox) =>
      `Mindwtr OK: ${open} tarea(s) abierta(s), ${inbox} en la bandeja de entrada.`,
    failed: (reason) => `Mindwtr: ${reason}.`,
  },
};

// Errors of the scene actions and the widget buttons (shown in Gladys).
export const ACTION_TEXT = {
  notConfigured: {
    en: 'Mindwtr is not configured.',
    fr: "Mindwtr n'est pas configuré.",
    de: 'Mindwtr ist nicht konfiguriert.',
    es: 'Mindwtr no está configurado.',
  },
  emptyTask: {
    en: 'Give the title of the task.',
    fr: 'Indiquez le titre de la tâche.',
    de: 'Gib den Titel der Aufgabe an.',
    es: 'Indique el título de la tarea.',
  },
  taskNotFound: {
    en: 'No open task has this title in Mindwtr.',
    fr: 'Aucune tâche ouverte ne porte ce titre dans Mindwtr.',
    de: 'Keine offene Aufgabe in Mindwtr hat diesen Titel.',
    es: 'Ninguna tarea abierta tiene este título en Mindwtr.',
  },
  taskAmbiguous: {
    en: 'Several open tasks have this title: rename one in Mindwtr.',
    fr: 'Plusieurs tâches ouvertes portent ce titre : renommez-en une dans Mindwtr.',
    de: 'Mehrere offene Aufgaben haben diesen Titel: Benenne eine in Mindwtr um.',
    es: 'Varias tareas abiertas tienen este título: cambie el nombre de una en Mindwtr.',
  },
  badDueDate: {
    en: 'Due date not understood: e.g. 2026-10-25, 25/10, tomorrow 18:30.',
    fr: 'Échéance incomprise : ex. 2026-10-25, 25/10, demain 18h30.',
    de: 'Fälligkeit nicht verstanden: z. B. 2026-10-25, 25.10., morgen 18:30.',
    es: 'Vencimiento no válido: p. ej. 2026-10-25, 25/10, mañana 18:30.',
  },
  alreadyDone: {
    en: 'This task was already done meanwhile: the list is refreshed.',
    fr: 'Cette tâche a déjà été terminée entre-temps : la liste est mise à jour.',
    de: 'Diese Aufgabe wurde inzwischen schon erledigt: Die Liste wird aktualisiert.',
    es: 'Esta tarea ya se ha terminado entretanto: la lista se actualiza.',
  },
};

// Toasts and scene results (≤ 200 characters).
export const DONE_TEXT = {
  en: { done: (title) => `"${title}" marked done.`, created: (title) => `"${title}" added.` },
  fr: {
    done: (title) => `« ${title} » terminée.`,
    created: (title) => `« ${title} » ajoutée à la boîte de réception.`,
  },
  de: {
    done: (title) => `„${title}“ als erledigt markiert.`,
    created: (title) => `„${title}“ zum Eingang hinzugefügt.`,
  },
  es: {
    done: (title) => `«${title}» terminada.`,
    created: (title) => `«${title}» añadida a la bandeja de entrada.`,
  },
};

// The sentence of the "Read today's tasks" scene action, for a message or a
// voice announcement.
const join = (titles, and) =>
  titles.length < 2 ? titles.join('') : `${titles.slice(0, -1).join(', ')} ${and} ${titles.at(-1)}`;

export const TODAY_TEXT = {
  en: {
    none: 'Nothing due today.',
    list: (count, titles) => `${count} task(s) for today: ${join(titles, 'and')}.`,
    overdue: (count) => ` ${count} overdue.`,
    inbox: (count) => ` ${count} in the inbox.`,
  },
  fr: {
    none: "Aucune tâche pour aujourd'hui.",
    list: (count, titles) => `${count} tâche(s) pour aujourd'hui : ${join(titles, 'et')}.`,
    overdue: (count) => ` ${count} en retard.`,
    inbox: (count) => ` ${count} dans la boîte de réception.`,
  },
  de: {
    none: 'Heute ist nichts fällig.',
    list: (count, titles) => `${count} Aufgabe(n) für heute: ${join(titles, 'und')}.`,
    overdue: (count) => ` ${count} überfällig.`,
    inbox: (count) => ` ${count} im Eingang.`,
  },
  es: {
    none: 'No hay nada para hoy.',
    list: (count, titles) => `${count} tarea(s) para hoy: ${join(titles, 'y')}.`,
    overdue: (count) => ` ${count} atrasada(s).`,
    inbox: (count) => ` ${count} en la bandeja de entrada.`,
  },
};

export const LANGUAGE_FALLBACK = 'en';

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** A multi-language object from a function of the language. */
export const allLanguages = (render) =>
  Object.fromEntries(Object.keys(INIT_FAILED).map((language) => [language, render(language)]));
