// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Mindwtr server on a fake
// network, a temporary /data, a manual clock and the Paris time zone, with
// the integration wired on top through registerHandlers. No timer runs unless
// `timers: true` (with node:test mock timers): the tests read Mindwtr with
// `world.hub.poll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FakeMindwtr, TOKEN, createNetwork } from './fakeMindwtr.js';

// The integration logs its lifecycle; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

// A name at home: the device transport is `local`.
export const URL_1 = 'http://mindwtr.lan:8787';
export const TIME_ZONE = 'Europe/Paris';
// The fixtures were captured on 21/10/2026 at 14:35 UTC; the tests start at
// 14:40 UTC (16:40 in Paris, a Wednesday): two tasks in the inbox, five next
// actions, one waiting; overdue: the bill (due yesterday) and the car service
// (09:00 today); due today: the plumber (no time), the car service and the
// bins (19:00); one task done today.
export const START = Date.UTC(2026, 9, 21, 14, 40, 0);

export function createClock(start = START) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const BASE_CONFIG = { url: URL_1, api_token: TOKEN, language: 'en' };

/**
 * @param {object} [options]
 * @param {FakeMindwtr} [options.server]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 */
export async function createWorld({
  clock = createClock(),
  server,
  config = BASE_CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-mindwtr-')),
  timings = {},
  timers = false,
} = {}) {
  const mindwtr = server ?? new FakeMindwtr({ now: clock.now });
  const network = createNetwork({ [URL_1]: mindwtr });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: network.request,
    timers,
    timings,
    now: clock.now,
    timeZone: TIME_ZONE,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, server: mindwtr, app, hub: app.hub, clock, dataDir };
}

export const serverId = (gladys) => gladys.externalIds('server', 'main');

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

export { FakeMindwtr, TOKEN };
