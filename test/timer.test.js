// -----------------------------------------------------------------------------
// The reading timer of the container. Gladys never polls a device published
// with should_poll: false (nor one created without should_poll,
// GladysAssistant/Gladys#3198): Mindwtr must be read by the hub's own timer,
// with no onPoll at all — and on time for a due date between two readings.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOKEN, URL_1, createAll, createClock, createWorld, serverId } from './helpers/world.js';

const settle = async () => {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const reads = (server) =>
  server.requests.filter((r) => r.path === '/v1/tasks' && r.search.startsWith('limit')).length;

test('the internal timer reads Mindwtr without any onPoll from Gladys', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock();
  const w = await createWorld({
    clock,
    config: {
      url: URL_1,
      api_token: TOKEN,
      poll_interval: '120',
    },
    timers: true,
  });
  t.after(() => w.app.stop());
  const polled = t.mock.method(w.hub, 'poll');
  await createAll(w);
  assert.equal(w.fake.discoveredDevices[0].should_poll, false, 'Gladys is not asked to poll');

  const before = reads(w.server);
  for (let i = 0; i < 3; i += 1) {
    clock.advance(120_000);
    t.mock.timers.tick(120_000);
    await settle();
  }
  assert.equal(reads(w.server) - before, 3, 'one reading per interval');
  assert.ok(polled.mock.callCount() >= 3);
});

test('the timer wakes up at a due time shorter than the interval', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // The bins are due at 19:00 in Paris, 17:00 UTC.
  const clock = createClock(Date.UTC(2026, 9, 21, 16, 58));
  const w = await createWorld({
    clock,
    config: {
      url: URL_1,
      api_token: TOKEN,
      poll_interval: '600',
    },
    timers: true,
  });
  t.after(() => w.app.stop());
  const overdue = serverId(w.gladys).feature('overdue');
  assert.equal(w.fake.lastState(overdue), 2);
  clock.advance(122_000);
  t.mock.timers.tick(122_000);
  await settle();
  assert.equal(w.fake.lastState(overdue), 3, 'read two minutes later, not ten');
  assert.deepEqual(
    w.fake.sceneEvents.map((event) => [event.key, event.data.task]),
    [['task_due', 'Take out the bins']],
  );
});

test('the timer stops with the integration', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = await createWorld({ timers: true });
  await w.app.stop();
  const before = w.server.requests.length;
  t.mock.timers.tick(60 * 60_000);
  await settle();
  assert.equal(w.server.requests.length, before);
});
