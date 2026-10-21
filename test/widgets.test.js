// -----------------------------------------------------------------------------
// The "today" widget: content within the core budget (validated by the SDK's
// validateWidgetContent), the "done" buttons, and the degraded states.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createClock, createWorld } from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

async function content(w, language = 'en') {
  const ack = await w.fake.widgetGet('tasks_today', { settings: {}, language, units: 'metric' });
  assert.equal(ack.success, true, ack.error);
  const { content: tree } = ack.data;
  assert.deepEqual(validateWidgetContent(tree), [], 'within the core vocabulary and budget');
  return tree;
}

const ofType = (data, type) => data.components.filter((component) => component.type === type);

test('tiles, the tasks of the day overdue first, four buttons', async (t) => {
  const w = await world(t);
  const data = await content(w);
  assert.ok(data.components.length <= 8);
  assert.deepEqual(
    ofType(data, 'value').map((tile) => [tile.label, tile.value]),
    [
      ['Due today', 3],
      ['Overdue', 2],
    ],
  );
  assert.deepEqual(
    ofType(data, 'status')[0].items.map((row) => [row.label, row.value, row.color]),
    [
      ['Pay the electricity bill', 'Overdue', 'danger'],
      ['Book the car service', 'Overdue · @phone @errands', 'danger'],
      ['Take out the bins', '19:00 · @home', 'neutral'],
      ['Call the plumber', 'today · @phone', 'neutral'],
    ],
  );
  const byTitle = (title) => w.server.tasks.find((task) => task.title === title).id;
  assert.deepEqual(
    ofType(data, 'button').map((button) => [button.action.key, button.action.params.id]),
    [
      ['done_1', byTitle('Pay the electricity bill')],
      ['done_2', byTitle('Book the car service')],
      ['done_3', byTitle('Take out the bins')],
      ['done_4', byTitle('Call the plumber')],
    ],
  );
  const french = await content(w, 'fr');
  assert.equal(ofType(french, 'status')[0].items[3].value, "aujourd'hui · @phone");
});

test('nothing left today: a sentence and the next due date', async (t) => {
  const w = await world(t);
  for (const task of w.server.tasks) {
    if (task.dueDate?.startsWith('2026-10-2') && task.dueDate < '2026-10-22') {
      w.server.markDone(task);
    }
  }
  await w.hub.poll();
  const data = await content(w);
  assert.equal(ofType(data, 'text')[0].text, 'Nothing left for today.');
  assert.deepEqual(
    ofType(data, 'status')[0].items.map((row) => [row.label, row.value]),
    [['Water the plants', 'Next · Thu 22 Oct']],
  );
  assert.deepEqual(ofType(data, 'button'), []);
});

test('a "done" button marks the task done and answers a toast', async (t) => {
  const w = await world(t);
  const bins = w.server.tasks.find((task) => task.title === 'Take out the bins');
  const ack = await w.fake.widgetAction('tasks_today', 'done_3', { id: bins.id }, { settings: {} });
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.message.fr, '« Take out the bins » terminée.');
  assert.equal(bins.status, 'done');
  const bad = await w.fake.widgetAction('tasks_today', 'done_9', { id: bins.id }, { settings: {} });
  assert.equal(bad.success, false);
});

test('a stale button completes nothing', async (t) => {
  const w = await world(t);
  const bins = w.server.tasks.find((task) => task.title === 'Take out the bins');
  w.server.markDone(bins); // done on a phone meanwhile
  const ack = await w.fake.widgetAction('tasks_today', 'done_3', { id: bins.id }, { settings: {} });
  assert.equal(ack.success, false);
  assert.match(ack.error, /already done meanwhile/);
  assert.equal(bins.rev, 2, 'not completed twice');
});

test('degraded states: not configured, Mindwtr down', async (t) => {
  const empty = await world(t, { config: { url: '', api_token: '' } });
  assert.match((await content(empty)).components[0].text, /Enter the address/);

  const w = await world(t);
  w.server.online = false;
  await w.hub.poll();
  const stale = await content(w);
  assert.equal(stale.components[0].variant, 'caption');
  assert.deepEqual(ofType(stale, 'button'), [], 'no button while Mindwtr is down');

  const down = await createWorld({ clock: createClock(), connect: false });
  t.after(() => down.app.stop());
  down.server.online = false;
  await down.gladys.connect();
  await down.app.ready;
  assert.match((await content(down)).components[0].text, /does not answer/);
});
