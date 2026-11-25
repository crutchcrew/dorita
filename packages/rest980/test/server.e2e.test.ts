// Runs the real server and dorita980 against the mock robot over MQTT/TLS.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import net from 'node:net';
import { createMockRobot } from '@dorita980/mock-robot';
import type { MockRobot } from '@dorita980/mock-robot';
import { startServer } from '../server/index.ts';
import type { Config, Server } from '../server/index.ts';

async function waitFor<T>(check: () => T | Promise<T>, timeoutMs?: number): Promise<T> {
  const deadline = Date.now() + (timeoutMs || 5000);
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('Timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function configFor(robotPort: number, overrides: Partial<Config> = {}): Config {
  return {
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
    sslCertFile: null,
    trustedNetworks: null,
    internalPort: null,
    robotCiphers: null,
    robotTlsMaxVersion: null,
    ...overrides,
  };
}

// Listens the way the server does (no host: all addresses).
function listenOn(port: number): Promise<net.Server> {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve(server));
  });
}

async function freePort(): Promise<number> {
  const server = await listenOn(0);
  const { port } = server.address() as net.AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const ping = (port: number | null): Promise<number> =>
  fetch('http://127.0.0.1:' + port + '/ping').then((res) => res.status);

// Starts a server that trusts only `trustedNetworks` and pings it from 127.0.0.1.
async function pingStatus(trustedNetworks: string, useNodeHttp: boolean): Promise<number> {
  const server = await startServer({
    config: configFor(1, { trustedNetworks, enableLocal: 'no' }),
    log: false,
    useNodeHttp,
  });
  try {
    return (await fetch('http://127.0.0.1:' + server.port + '/ping')).status;
  } finally {
    await server.stop();
  }
}

describe('robot TLS settings', () => {
  it('connects with TLS capped at 1.2, as some robots need', async () => {
    const mock = createMockRobot({ tickMs: 50 });
    const robotPort = await mock.listen(0);
    const server = await startServer({
      config: configFor(robotPort, { robotTlsMaxVersion: 'TLSv1.2' }),
      log: false,
    });
    try {
      await waitFor(() => server.robot.connection === 'connected');
    } finally {
      await server.stop();
      await mock.close();
    }
  });
});

for (const useNodeHttp of [false, true]) {
  describe(
    'rest980 with a firmware 2 robot (' + (useNodeHttp ? 'node:http' : 'Bun.serve') + ')',
    () => {
      let mock: MockRobot, server: Server, base: string;

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

      const get = (path: string): Promise<any> => fetch(base + path).then((res) => res.json());
      const post = (path: string, body?: unknown): Promise<any> =>
        fetch(base + path, {
          method: 'POST',
          headers: body ? { 'Content-Type': 'application/json' } : {},
          body: body ? JSON.stringify(body) : undefined,
        }).then((res) => res.json());

      it('sees the client address, for trusted networks', async () => {
        expect(await pingStatus('127.0.0.1', useNodeHttp)).toBe(200);
        expect(await pingStatus('192.0.2.1', useNodeHttp)).toBe(403);
      });

      it('frees the main port when the internal one cannot bind', async () => {
        const busy = await listenOn(0);
        const mainPort = await freePort();
        const config = configFor(1, {
          port: mainPort,
          internalPort: (busy.address() as net.AddressInfo).port,
          enableLocal: 'no',
        });
        try {
          await expect(startServer({ config, log: false, useNodeHttp })).rejects.toThrow();
          // Fails with EADDRINUSE if startServer left the main listener open.
          (await listenOn(mainPort)).close();
        } finally {
          busy.close();
        }
      });

      it('trusts only the internal listener when there is one', async () => {
        const split = await startServer({
          config: configFor(1, {
            trustedNetworks: '127.0.0.1',
            internalPort: 0,
            enableLocal: 'no',
          }),
          log: false,
          useNodeHttp,
        });
        try {
          expect(split.internalPort).toBeGreaterThan(0);
          expect(await ping(split.internalPort)).toBe(200);
          expect(await ping(split.port)).toBe(403);
        } finally {
          await split.stop();
        }
      });

      it('reports a live connection and the robot state', async () => {
        const status = await waitFor(async () => {
          const current = await get('/api/status');
          return current.state && current.state.name ? current : null;
        });
        expect(status.connection).toBe('connected');
        expect(status.live).toBe(true);
        expect(status.state.name).toBe('Mock Roomba');
      });

      it('starts cleaning and tracks the path', async () => {
        expect(await post('/api/local/action/clean')).toEqual({ ok: null });
        await waitFor(() => mock.commands.some((c) => c.command === 'clean'));
        const mission = await waitFor(async () => {
          const current = await get('/api/local/info/mission');
          return current.cleanMissionStatus.phase === 'run' ? current : null;
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
        const week = {
          cycle: ['start', 'none', 'none', 'none', 'none', 'none', 'start'],
          h: [8, 9, 9, 9, 9, 9, 10],
          m: [0, 0, 0, 0, 0, 0, 15],
        };
        await post('/api/local/config/week', week);
        await waitFor(() => JSON.stringify(mock.state.cleanSchedule) === JSON.stringify(week));
        expect(await get('/api/local/config/week')).toEqual(week);
      });

      it('survives a malformed Host header', async () => {
        const raw = await new Promise((resolve, reject) => {
          const socket = net.connect(server.port, '127.0.0.1', () => {
            socket.write('GET /ping HTTP/1.1\r\nHost: bad host\r\nConnection: close\r\n\r\n');
          });
          let data = '';
          socket.on('data', (chunk) => {
            data += chunk;
          });
          socket.on('end', () => resolve(data));
          socket.on('error', reject);
        });
        // node:http can't build a Request from it (400); Bun.serve passes a
        // relative URL that the app resolves.
        expect(raw).toMatch(useNodeHttp ? /^HTTP\/1\.1 400/ : /^HTTP\/1\.1 200/);
        expect((await fetch(base + '/ping')).status).toBe(200);
      });

      it('streams state over server-sent events', async () => {
        const controller = new AbortController();
        const res = await fetch(base + '/api/events', { signal: controller.signal });
        const reader = res.body!.getReader();
        let text = '';
        while (!(text.includes('event: state') && text.includes('event: mission'))) {
          const { value } = await reader.read();
          text += new TextDecoder().decode(value);
        }
        controller.abort();
        expect(text).toContain('event: status');
        expect(text).toContain('"name":"Mock Roomba"');
      });
    },
  );
}

describe('rest980 with keepAlive=no', () => {
  let mock: MockRobot, server: Server, base: string;

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
    const status = (await (await fetch(base + '/api/status')).json()) as any;
    expect(status.connection).toBe('on-demand');
    expect(status.live).toBe(false);

    const res = await fetch(base + '/api/local/action/find', { method: 'POST' });
    expect(await res.json()).toEqual({ ok: null });
    await waitFor(() => mock.commands.some((c) => c.command === 'find'));

    const state = (await (await fetch(base + '/api/local/info/state')).json()) as any;
    expect(state.name).toBe('Mock Roomba');
  });
});

describe('rest980 with wrong robot credentials', () => {
  let mock: MockRobot, server: Server;

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
      const current = (await (
        await fetch('http://127.0.0.1:' + server.port + '/api/status')
      ).json()) as any;
      return current.lastError ? current : null;
    });
    expect(status.connection).not.toBe('connected');
    expect(status.lastError.message).toMatch(/not authorized|bad user|connection refused/i);
  });
});
