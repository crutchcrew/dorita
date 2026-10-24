'use strict';

// Runs the real server and dorita980 against the mock robot over MQTT/TLS.

const { describe, it, expect, beforeAll, afterAll } = require('bun:test');
const { createMockRobot } = require('../scripts/mock-robot');
const { startServer } = require('../server');

async function waitFor (check, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 5000);
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('Timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function configFor (robotPort, overrides) {
  return Object.assign({
    port: 0,
    blid: 'mockblid',
    password: 'mockpass',
    robotIP: '127.0.0.1',
    robotPort,
    firmwareVersion: 2,
    enableLocal: 'yes',
    enableCloud: 'no',
    keepAlive: 'yes',
    basicAuthUser: null,
    basicAuthPass: null,
    sslKeyFile: null,
    sslCertFile: null
  }, overrides);
}

for (const useNodeHttp of [false, true]) {
  describe('rest980 with a firmware 2 robot (' + (useNodeHttp ? 'node:http' : 'Bun.serve') + ')', () => {
    let mock, server, base;

    beforeAll(async () => {
      mock = createMockRobot({ tickMs: 50 });
      const robotPort = await mock.listen(0);
      server = await startServer({ config: configFor(robotPort), log: false, useNodeHttp });
      base = 'http://127.0.0.1:' + server.port;
      await waitFor(() => server.robot.connection === 'connected');
    });

    afterAll(async () => {
      await server.stop();
      await mock.close();
    });

    const get = (path) => fetch(base + path).then((res) => res.json());
    const post = (path, body) => fetch(base + path, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then((res) => res.json());

    it('reports a live connection and the robot state', async () => {
      const status = await waitFor(async () => {
        const status = await get('/api/status');
        return status.state && status.state.name ? status : null;
      });
      expect(status.connection).toBe('connected');
      expect(status.live).toBe(true);
      expect(status.state.name).toBe('Mock Roomba');
    });

    it('starts cleaning and tracks the path', async () => {
      expect(await post('/api/local/action/clean')).toEqual({ ok: null });
      await waitFor(() => mock.commands.some((c) => c.command === 'clean'));
      const mission = await waitFor(async () => {
        const mission = await get('/api/local/info/mission');
        return mission.cleanMissionStatus.phase === 'run' ? mission : null;
      });
      expect(mission.cleanMissionStatus.cycle).toBe('clean');
      await waitFor(async () => (await get('/api/status')).path.length > 1);
    });

    it('clears the tracked path', async () => {
      await fetch(base + '/api/path', { method: 'DELETE' });
      expect(server.robot.path.length).toBeLessThan(3);
    });

    it('pauses and docks', async () => {
      await post('/api/local/action/pause');
      await waitFor(() => mock.state.cleanMissionStatus.phase === 'stop');
      await post('/api/local/action/dock');
      await waitFor(() => mock.state.cleanMissionStatus.phase === 'charge', 8000);
    });

    it('changes preferences', async () => {
      await post('/api/local/config/carpetBoost/performance');
      await waitFor(() => mock.state.vacHigh === true && mock.state.carpetBoost === false);
      await post('/api/local/config/edgeClean/off');
      await waitFor(() => mock.state.openOnly === true);
    });

    it('updates the weekly schedule', async () => {
      const week = { cycle: ['start', 'none', 'none', 'none', 'none', 'none', 'start'], h: [8, 9, 9, 9, 9, 9, 10], m: [0, 0, 0, 0, 0, 0, 15] };
      await post('/api/local/config/week', week);
      await waitFor(() => JSON.stringify(mock.state.cleanSchedule) === JSON.stringify(week));
      expect(await get('/api/local/config/week')).toEqual(week);
    });

    it('streams state over server-sent events', async () => {
      const controller = new AbortController();
      const res = await fetch(base + '/api/events', { signal: controller.signal });
      const reader = res.body.getReader();
      let text = '';
      while (!(text.includes('event: state') && text.includes('event: mission'))) {
        const { value } = await reader.read();
        text += new TextDecoder().decode(value);
      }
      controller.abort();
      expect(text).toContain('event: status');
      expect(text).toContain('"name":"Mock Roomba"');
    });
  });
}

describe('rest980 with keepAlive=no', () => {
  let mock, server, base;

  beforeAll(async () => {
    mock = createMockRobot({ tickMs: 50 });
    const robotPort = await mock.listen(0);
    server = await startServer({ config: configFor(robotPort, { keepAlive: 'no' }), log: false });
    base = 'http://127.0.0.1:' + server.port;
  });

  afterAll(async () => {
    await server.stop();
    await mock.close();
  });

  it('connects for each request', async () => {
    const status = await (await fetch(base + '/api/status')).json();
    expect(status.connection).toBe('on-demand');
    expect(status.live).toBe(false);

    const res = await fetch(base + '/api/local/action/find', { method: 'POST' });
    expect(await res.json()).toEqual({ ok: null });
    await waitFor(() => mock.commands.some((c) => c.command === 'find'));

    const state = await (await fetch(base + '/api/local/info/state')).json();
    expect(state.name).toBe('Mock Roomba');
  });
});

describe('rest980 with wrong robot credentials', () => {
  let mock, server;

  beforeAll(async () => {
    mock = createMockRobot();
    const robotPort = await mock.listen(0);
    server = await startServer({ config: configFor(robotPort, { password: 'wrong' }), log: false });
  });

  afterAll(async () => {
    await server.stop();
    await mock.close();
  });

  it('reports the connection error', async () => {
    const status = await waitFor(async () => {
      const status = await (await fetch('http://127.0.0.1:' + server.port + '/api/status')).json();
      return status.lastError ? status : null;
    });
    expect(status.connection).not.toBe('connected');
    expect(status.lastError.message).toMatch(/not authorized|bad user|connection refused/i);
  });
});
