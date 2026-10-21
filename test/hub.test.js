// -----------------------------------------------------------------------------
// The hub against the in-memory Mindwtr server (real answers of mindwtr-cloud
// 1.3.6): counters, scene events, the scene actions and the error cases. The
// clock starts on 21/10/2026 at 16:40 in Paris.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_CONFIG,
  FakeMindwtr,
  START,
  TOKEN,
  createAll,
  createClock,
  createWorld,
  serverId,
} from './helpers/world.js';

const HOUR = 60 * 60_000;
const at = (d, h, m = 0, s = 0) => Date.UTC(2026, 9, d, h, m, s); // UTC, October 2026

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const counters = (w) => {
  const ids = serverId(w.gladys);
  const state = (key) => w.fake.lastState(ids.feature(key));
  return {
    inbox: state('inbox'),
    next: state('next_actions'),
    waiting: state('waiting'),
    overdue: state('overdue'),
    dueToday: state('due_today'),
    doneToday: state('done_today'),
    nextDue: state('next_due'),
  };
};

const transport = (w, id) =>
  w.fake.transports.filter((entry) => (entry.device_external_id ?? entry.external_id) === id).at(-1)
    ?.transport;

const events = (w) => w.fake.sceneEvents.map((event) => `${event.key}:${event.data.task ?? ''}`);

test('one device, its counters and the next due date', async (t) => {
  const w = await world(t);
  assert.equal(w.fake.discoveredDevices.length, 1);
  assert.equal(w.fake.discoveredDevices[0].name, 'Mindwtr');
  assert.deepEqual(counters(w), {
    inbox: 2,
    next: 5,
    waiting: 1,
    overdue: 2,
    dueToday: 3,
    doneToday: 1,
    nextDue: 'Take out the bins · 19:00',
  });
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('the day turns at local midnight, not UTC midnight', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  clock.time = at(21, 21, 59); // 23:59 in Paris
  await w.hub.poll();
  assert.equal(counters(w).doneToday, 1);
  assert.equal(counters(w).overdue, 3, 'the bins at 19:00');
  clock.time = at(21, 22, 1); // 00:01 in Paris
  await w.hub.poll();
  assert.equal(counters(w).doneToday, 0);
  assert.equal(counters(w).overdue, 4, 'the plumber, due yesterday');
  assert.equal(counters(w).dueToday, 1, 'the plants, today');
  assert.equal(counters(w).nextDue, 'Water the plants · today');
});

test('nothing fires at the first reading; due times and midnight fire once', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  assert.deepEqual(events(w), []);
  clock.time = at(21, 17, 0, 2);
  await w.hub.poll();
  await w.hub.poll();
  assert.deepEqual(events(w), ['task_due:Take out the bins']);
  const due = w.fake.sceneEvents[0].data;
  assert.equal(due.status, 'next');
  assert.equal(due.contexts, '@home');
  assert.equal(due.due_date, '2026-10-21T19:00');
  assert.equal(due.all_day, false);

  clock.time = at(21, 22, 0, 2); // midnight in Paris
  await w.hub.poll();
  assert.deepEqual(events(w).slice(1), [
    'task_overdue:Book the car service',
    'task_overdue:Take out the bins',
    'task_overdue:Call the plumber',
    'task_due:Water the plants',
  ]);
  const plants = w.fake.sceneEvents.at(-1).data;
  assert.equal(plants.all_day, true);
  assert.equal(plants.project_name, '');
  const bill = w.server.tasks.find((task) => task.title === 'Pay the electricity bill');
  assert.equal(bill.projectId !== undefined, true);
});

test('the events carry the project name', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  // The passport, due 28/10, at midnight in Paris (UTC+1 since 25/10).
  clock.time = at(27, 23, 0, 2);
  w.hub.saved.readAt = at(27, 22, 30);
  await w.hub.poll();
  const passport = w.fake.sceneEvents.find((event) => event.data.task === 'Renew the passport');
  assert.equal(passport.key, 'task_due');
  assert.equal(passport.data.project_name, 'Home');
});

test('a task done before its due time fires nothing', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  w.server.markDone(w.server.tasks.find((task) => task.title === 'Take out the bins'));
  clock.time = at(21, 17, 0, 2);
  await w.hub.poll();
  assert.deepEqual(events(w), []);
});

test('the events survive a restart, without repeats, and are dropped when too late', async (t) => {
  const clock = createClock();
  const first = await createWorld({ clock });
  await first.app.stop();
  clock.time = at(21, 17, 0, 2);
  const second = await world(t, { clock, server: first.server, dataDir: first.dataDir });
  assert.deepEqual(events(second), ['task_due:Take out the bins'], 'passed while it was down');
  await second.app.stop();
  const third = await world(t, { clock, server: first.server, dataDir: first.dataDir });
  assert.deepEqual(events(third), [], 'not repeated');
  await third.app.stop();
  clock.time = at(21, 23, 30); // the midnight events are 1.5 h old
  const fourth = await world(t, { clock, server: first.server, dataDir: first.dataDir });
  assert.deepEqual(events(fourth), [], 'too late, dropped');
});

test('the inbox review: after the delay, then at the same interval until emptied', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock, config: { ...BASE_CONFIG, inbox_review_hours: '4' } });
  clock.time = at(21, 18, 30);
  await w.hub.poll();
  assert.deepEqual(events(w), []);
  clock.time = at(21, 18, 36); // the mail came at 14:35 UTC
  await w.hub.poll();
  await w.hub.poll();
  assert.deepEqual(
    w.fake.sceneEvents.map((event) => [event.key, event.data]),
    [['inbox_review', { inbox_count: 2, oldest_task: 'Sort the mail', oldest_age_hours: 4 }]],
  );
  clock.time = at(21, 22, 35);
  await w.hub.poll();
  assert.equal(w.fake.sceneEvents.filter((event) => event.key === 'inbox_review').length, 1);
  clock.time = at(21, 22, 37);
  await w.hub.poll();
  assert.equal(w.fake.sceneEvents.filter((event) => event.key === 'inbox_review').length, 2);

  // Emptied, then a new item: four hours from that one.
  for (const task of w.server.tasks.filter((item) => item.status === 'inbox')) {
    task.status = 'next';
  }
  await w.hub.poll();
  w.server.add('Idea for the garden');
  clock.time = at(22, 1, 0);
  await w.hub.poll();
  const reviews = () => w.fake.sceneEvents.filter((event) => event.key === 'inbox_review');
  assert.equal(reviews().length, 2);
  clock.time = at(21, 22, 37) + 4 * HOUR + 60_000;
  await w.hub.poll();
  assert.equal(reviews().length, 3);
  assert.equal(reviews().at(-1).data.oldest_task, 'Idea for the garden');
});

test('an inbox already old at the first reading waits one more delay', async (t) => {
  const clock = createClock(at(23, 10));
  const w = await world(t, { clock });
  assert.deepEqual(events(w), []);
  clock.advance(HOUR);
  await w.hub.poll();
  assert.deepEqual(events(w), []);
  clock.advance(23 * HOUR);
  await w.hub.poll();
  assert.equal(events(w).filter((event) => event.startsWith('inbox_review')).length, 1);
});

test('task added: from an app or from Gladys, not the next occurrence of a repeating task', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  clock.advance(60_000);
  w.server.add('Buy bread', { contexts: ['@errands'] });
  await w.hub.poll();
  await w.hub.poll();
  assert.deepEqual(
    w.fake.sceneEvents.map((event) => [event.key, event.data.task, event.data.from_gladys]),
    [['task_added', 'Buy bread', false]],
  );

  const ack = await w.fake.sceneAction('add_task', { title: 'Call grandma' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(w.fake.sceneEvents.at(-1).data.from_gladys, true);

  const before = w.fake.sceneEvents.length;
  const done = await w.fake.sceneAction('complete_task', { task: 'Water the plants' });
  assert.equal(done.success, true, done.error);
  await w.hub.poll();
  assert.equal(w.fake.sceneEvents.length, before, 'the next occurrence is no new task');
  assert.ok(
    w.server.tasks.some(
      (task) => task.title === 'Water the plants' && task.dueDate === '2026-10-23',
    ),
  );
});

test('add_task: in the inbox, with a due date and contexts, never through /v1/data', async (t) => {
  const w = await world(t);
  const ack = await w.fake.sceneAction('add_task', {
    title: '  Buy #milk   @shop ',
    due_date: 'demain 18h30',
    context: 'errands',
  });
  assert.equal(ack.success, true, ack.error);
  const task = w.server.tasks.at(-1);
  assert.equal(task.title, 'Buy #milk @shop', 'no quick-add parsing of the title');
  assert.equal(task.status, 'inbox');
  assert.equal(task.dueDate, '2026-10-22T18:30');
  assert.deepEqual(task.contexts, ['@errands']);
  assert.deepEqual(ack.data.outputs, {
    task: 'Buy #milk @shop',
    task_id: task.id,
    due_date: '2026-10-22T18:30',
  });
  assert.equal(counters(w).inbox, 3, 'read again at once');

  const bad = await w.fake.sceneAction('add_task', { title: 'X', due_date: 'someday' });
  assert.equal(bad.success, false);
  assert.match(bad.error, /Due date not understood/);
  const empty = await w.fake.sceneAction('add_task', { title: '  ' });
  assert.equal(empty.success, false);

  assert.equal(w.server.dataWrites, 0);
  assert.ok(!w.server.requests.some((request) => request.path === '/v1/data'));
});

test('complete_task: by title or id; a done or unknown task is refused', async (t) => {
  const w = await world(t);
  const ack = await w.fake.sceneAction('complete_task', { task: 'take OUT the bins' });
  assert.equal(ack.success, true, ack.error);
  const bins = w.server.tasks.find((task) => task.title === 'Take out the bins');
  assert.equal(bins.status, 'done');
  assert.deepEqual(ack.data.outputs, { task: 'Take out the bins', task_id: bins.id });
  assert.equal(counters(w).doneToday, 2);

  const again = await w.fake.sceneAction('complete_task', { task: bins.id });
  assert.equal(again.success, false);
  assert.match(again.error, /No open task/);
  assert.equal(bins.rev, 2, 'not completed twice');

  const mail = w.server.tasks.find((task) => task.title === 'Sort the mail');
  const byId = await w.fake.sceneAction('complete_task', { task: mail.id });
  assert.equal(byId.success, true, byId.error);
  assert.equal(mail.status, 'done');

  const reference = await w.fake.sceneAction('complete_task', { task: 'Wifi password' });
  assert.equal(reference.success, false, 'a reference note is no task');
});

test('read_today: a sentence for a message or a voice announcement', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, language: 'fr' } });
  const ack = await w.fake.sceneAction('read_today', {});
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    text: "4 tâche(s) pour aujourd'hui : Pay the electricity bill, Book the car service, Take out the bins et Call the plumber. 2 en retard. 2 dans la boîte de réception.",
    count: 4,
    overdue: 2,
    inbox: 2,
  });
  const phone = await w.fake.sceneAction('read_today', { context: '@phone' });
  assert.equal(phone.data.outputs.count, 2);
  const none = await w.fake.sceneAction('read_today', { context: '@garden' });
  assert.match(none.data.outputs.text, /^Aucune tâche pour aujourd'hui\./);
});

test('a token refused says so, and never shows it', async (t) => {
  const refused = await world(t, {
    config: { ...BASE_CONFIG, api_token: 'wrong-token-0123456789abcd' },
  });
  assert.equal(refused.fake.connectionStatus.connected, false);
  assert.match(refused.fake.connectionStatus.message.en, /token refused/);
  assert.equal(refused.fake.discoveredDevices.length, 0);
  const ack = await refused.fake.sceneAction('add_task', { title: 'X' });
  assert.equal(ack.success, false);
  assert.match(ack.error, /token refused.*\(HTTP 401\)/);
  assert.ok(!ack.error.includes('wrong-token'));
});

test('an address that is not the sync server, or that does not answer', async (t) => {
  const w = await world(t, { config: { ...BASE_CONFIG, url: 'http://192.0.2.99:8787' } });
  assert.match(w.fake.connectionStatus.message.en, /does not answer/);
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, false);
  assert.equal(ack.error, 'Mindwtr: the sync server does not answer.');

  const server = new FakeMindwtr({ now: createClock().now });
  server.handle = () => ({ status: 200, headers: {}, body: '<!doctype html>' });
  const html = await world(t, { server });
  assert.match(html.fake.connectionStatus.message.en, /no Mindwtr sync server/);

  const storage = new FakeMindwtr({ now: createClock().now });
  storage.failWith = 503;
  const broken = await world(t, { server: storage });
  assert.match(broken.fake.connectionStatus.message.en, /cannot use its data folder/);
});

test('test_connection reports what it finds', async (t) => {
  const w = await world(t);
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true, ack.error);
  assert.equal(
    ack.data.message.fr,
    'Mindwtr OK : 9 tâche(s) ouverte(s), 2 dans la boîte de réception.',
  );
});

test('no configuration: a clear status, no request', async (t) => {
  const w = await world(t, { config: { url: '', api_token: '' } });
  assert.match(w.fake.connectionStatus.message.en, /Enter the address/);
  assert.equal(w.server.requests.length, 0);
  const typo = await world(t, { config: { url: 'http://', api_token: TOKEN } });
  assert.match(typo.fake.connectionStatus.message.en, /not understood/);
  const noToken = await world(t, { config: { url: BASE_CONFIG.url, api_token: '' } });
  assert.match(noToken.fake.connectionStatus.message.en, /sync token/);
});

test('an outage keeps the device and marks it unreachable, then back', async (t) => {
  const w = await world(t);
  const id = serverId(w.gladys).device;
  assert.equal(transport(w, id), 'local');
  w.server.online = false;
  await w.hub.poll();
  assert.equal(transport(w, id), 'unreachable');
  assert.equal(w.fake.discoveredDevices.length, 1);
  w.server.online = true;
  await w.hub.poll();
  assert.equal(transport(w, id), 'local');
});

test('every page of the task list is read', async (t) => {
  const server = new FakeMindwtr({ now: createClock().now });
  for (let i = 0; i < 1200; i += 1) {
    server.add(`Someday ${i}`, { status: 'someday', createdAt: '2026-01-01T00:00:00.000Z' });
  }
  const w = await world(t, { server });
  assert.equal(w.hub.tasks.length, 1209);
  const pages = server.requests.filter((r) => r.path === '/v1/tasks' && !r.search.includes('all'));
  assert.deepEqual(
    pages.map((r) => r.search),
    ['limit=500&offset=0', 'limit=500&offset=500', 'limit=500&offset=1000'],
  );
});

test('the states are published again when the device is added', async (t) => {
  const w = await world(t);
  const inbox = serverId(w.gladys).feature('inbox');
  const before = w.fake.states.filter((s) => s.device_feature_external_id === inbox).length;
  await createAll(w);
  const after = w.fake.states.filter((s) => s.device_feature_external_id === inbox).length;
  assert.equal(after, before + 1);
});

test('the fixtures start where the tests expect them', () => {
  assert.equal(new Date(START).toISOString(), '2026-10-21T14:40:00.000Z');
});

test('an event Gladys refuses is tried again at the next reading', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  const publish = w.gladys.publishSceneEvent.bind(w.gladys);
  let refuse = true;
  t.mock.method(w.gladys, 'publishSceneEvent', async (key, data) => {
    if (refuse) {
      throw new Error('Gladys is restarting');
    }
    return publish(key, data);
  });
  clock.time = at(21, 17, 0, 2);
  w.server.add('Buy bread');
  await w.hub.poll();
  assert.deepEqual(events(w), []);
  refuse = false;
  clock.advance(60_000);
  await w.hub.poll();
  assert.deepEqual(events(w).sort(), ['task_added:Buy bread', 'task_due:Take out the bins']);
});

test('two taps on the same button complete the task once', async (t) => {
  const w = await world(t);
  const plants = w.server.tasks.find(
    (task) => task.title === 'Water the plants' && task.status === 'next',
  );
  const tap = () =>
    w.fake.widgetAction('tasks_today', 'done_1', { id: plants.id }, { settings: {} });
  const [first, second] = await Promise.all([tap(), tap()]);
  assert.deepEqual([first.success, second.success].sort(), [false, true]);
  assert.equal(
    w.server.tasks.filter((task) => task.title === 'Water the plants').length,
    3,
    'one more occurrence, not two',
  );
});
