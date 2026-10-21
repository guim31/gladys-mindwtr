// -----------------------------------------------------------------------------
// Unit tests of the pure parts: the address typed by the user, the due dates
// of real Mindwtr answers, the counters, the search by title or id, the due
// dates and contexts typed in a scene, the home/Internet transport.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeConfig, parseServerUrl } from '../src/config.js';
import { isLocalHost } from '../src/hub.js';
import {
  findTask,
  localDay,
  parseContexts,
  parseDone,
  parseDueDate,
  parseDueInput,
  parseTasks,
  summarize,
  withContext,
} from '../src/mindwtr/model.js';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/mindwtr/${name}.json`, import.meta.url), 'utf8'));

const PARIS = 'Europe/Paris';
const NOW = Date.UTC(2026, 9, 21, 14, 40); // 16:40 in Paris

test('the address: bare host, the app URL, /v1/data, a reverse proxy prefix', () => {
  assert.equal(parseServerUrl('192.0.2.10:8787'), 'http://192.0.2.10:8787');
  assert.equal(parseServerUrl(' https://mindwtr.example.org/ '), 'https://mindwtr.example.org');
  assert.equal(parseServerUrl('http://192.0.2.10:8787/v1/data'), 'http://192.0.2.10:8787');
  assert.equal(parseServerUrl('http://192.0.2.10:8787/v1'), 'http://192.0.2.10:8787');
  assert.equal(parseServerUrl('http://192.0.2.10:8787/ready'), 'http://192.0.2.10:8787');
  assert.equal(parseServerUrl('https://example.org/mindwtr/'), 'https://example.org/mindwtr');
  assert.equal(parseServerUrl('https://user:pass@example.org'), null, 'no credentials');
  assert.equal(parseServerUrl('ftp://example.org'), null);
  assert.equal(parseServerUrl(''), null);
});

test('the defaults', () => {
  const config = normalizeConfig({ url: '192.0.2.10', api_token: ' abc ', poll_interval: '7' });
  assert.equal(config.token, 'abc');
  assert.equal(config.pollIntervalMs, 300_000);
  assert.equal(config.inboxReviewMs, 24 * 3_600_000);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ inbox_review_hours: '4' }).inboxReviewMs, 4 * 3_600_000);
});

test('due dates: a date is due by the end of the local day, a time is local', () => {
  assert.deepEqual(parseDueDate('2026-10-21', PARIS), {
    at: Date.UTC(2026, 9, 21, 22) - 1,
    allDay: true,
  });
  assert.deepEqual(parseDueDate('2026-10-21T19:00', PARIS), {
    at: Date.UTC(2026, 9, 21, 17),
    allDay: false,
  });
  // The clocks go back on 25/10: 09:00 is UTC+1 on the 26th.
  assert.equal(parseDueDate('2026-10-26T09:00', PARIS).at, Date.UTC(2026, 9, 26, 8));
  assert.equal(parseDueDate('2026-10-21T19:00:00Z', PARIS).at, Date.UTC(2026, 9, 21, 19));
  assert.equal(parseDueDate('nope', PARIS), null, 'the server stores anything');
  assert.equal(parseDueDate('2026-02-30', PARIS), null);
  assert.equal(parseDueDate('', PARIS), null);
  assert.equal(parseDueDate(undefined, PARIS), null);
});

test('real tasks: open ones only, sorted by due time, reference left out', () => {
  const tasks = parseTasks(fixture('real-tasks-open').tasks, PARIS);
  assert.equal(tasks.length, 9, 'the reference note is no task to do');
  assert.deepEqual(
    tasks.slice(0, 6).map((task) => [task.title, task.status, task.allDay]),
    [
      ['Pay the electricity bill', 'next', true],
      ['Book the car service', 'next', false],
      ['Take out the bins', 'next', false],
      ['Call the plumber', 'inbox', true],
      ['Water the plants', 'next', true],
      ['Renew the passport', 'next', true],
    ],
  );
  assert.deepEqual(tasks.find((task) => task.title === 'Book the car service').contexts, [
    '@phone',
    '@errands',
  ]);
  assert.equal(tasks.find((task) => task.title === 'Water the plants').recurring, true);
});

test('the counters of a day', () => {
  const tasks = parseTasks(fixture('real-tasks-open').tasks, PARIS);
  const done = parseDone(fixture('real-tasks-done').tasks);
  const summary = summarize(tasks, done, { now: NOW, day: localDay(NOW, PARIS) });
  assert.deepEqual(
    {
      inbox: summary.inbox,
      next: summary.next,
      waiting: summary.waiting,
      overdue: summary.overdue,
      dueToday: summary.dueToday,
      doneToday: summary.doneToday,
    },
    { inbox: 2, next: 5, waiting: 1, overdue: 2, dueToday: 3, doneToday: 1 },
  );
  assert.equal(summary.nextDue.title, 'Take out the bins');
  assert.equal(summary.oldestInbox.title, 'Sort the mail');
  assert.deepEqual(
    summary.today.map((task) => task.title),
    ['Pay the electricity bill', 'Book the car service', 'Take out the bins', 'Call the plumber'],
  );
  // Tomorrow, the done task is yesterday's.
  const tomorrow = NOW + 24 * 3_600_000;
  assert.equal(
    summarize(tasks, done, { now: tomorrow, day: localDay(tomorrow, PARIS) }).doneToday,
    0,
  );
  assert.deepEqual(
    withContext(tasks, 'PHONE').map((task) => task.title),
    ['Book the car service', 'Call the plumber'],
  );
});

test('find by exact title (case, accents, blanks ignored) or by id', () => {
  const tasks = parseTasks(
    [
      ...fixture('real-tasks-open').tasks,
      { id: 'x1', title: 'Réparer   le vélo', status: 'next' },
      { id: 'x2', title: 'Doublon', status: 'next' },
      { id: 'x3', title: 'doublon', status: 'inbox' },
    ],
    PARIS,
  );
  assert.equal(findTask(tasks, ' reparer le VELO ').task.id, 'x1');
  const bins = tasks.find((task) => task.title === 'Take out the bins');
  assert.equal(findTask(tasks, bins.id.toUpperCase()).task, bins);
  assert.equal(findTask(tasks, 'Doublon').reason, 'ambiguous');
  assert.equal(findTask(tasks, 'Nothing').reason, 'not_found');
  assert.equal(findTask(tasks, '  ').reason, 'empty');
});

test('due dates typed in a scene, in the four languages', () => {
  const parse = (value) => parseDueInput(value, { now: NOW, timeZone: PARIS });
  assert.equal(parse('2026-10-25'), '2026-10-25');
  assert.equal(parse('2026-10-25T08:15'), '2026-10-25T08:15');
  assert.equal(parse('25/10'), '2026-10-25');
  assert.equal(parse('20/10'), '2027-10-20', 'a day already passed: next year');
  assert.equal(parse('25.10.2026'), '2026-10-25');
  assert.equal(parse('demain 18h30'), '2026-10-22T18:30');
  assert.equal(parse('Demain à 18h'), '2026-10-22T18:00');
  assert.equal(parse('tomorrow at 6:30'), '2026-10-22T06:30');
  assert.equal(parse('morgen um 18:00'), '2026-10-22T18:00');
  assert.equal(parse('Mañana a las 18:00'), '2026-10-22T18:00');
  assert.equal(parse('aujourd’hui'), '2026-10-21');
  assert.equal(parse('hoy'), '2026-10-21');
  assert.equal(parse('18:30'), '2026-10-21T18:30');
  assert.equal(parse(''), null);
  assert.equal(parse(undefined), null);
  assert.equal(parse('next week'), undefined);
  assert.equal(parse('31/02'), undefined);
  assert.equal(parse('demain 25h'), undefined);
});

test('contexts typed in a scene', () => {
  assert.deepEqual(parseContexts('@home'), ['@home']);
  assert.deepEqual(parseContexts(' phone, @errands @phone'), ['@phone', '@errands']);
  assert.deepEqual(parseContexts(''), []);
});

test('a home address is local, any other is the Internet', () => {
  for (const host of [
    '192.168.1.20',
    '10.0.0.5',
    '172.20.1.1',
    'nas',
    'nas.local',
    'mindwtr.home.arpa',
    '100.64.1.2',
    'localhost',
    'fd12:3456::1',
  ]) {
    assert.equal(isLocalHost(host), true, host);
  }
  for (const host of ['mindwtr.example.org', '203.0.113.5', '172.32.0.1']) {
    assert.equal(isLocalHost(host), false, host);
  }
});
