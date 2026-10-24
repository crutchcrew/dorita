'use strict';

const { describe, it, expect } = require('bun:test');
const { createApp } = require('../server/app');
const { Robot } = require('../server/robot');

const baseConfig = {
  port: 0,
  blid: 'myblid',
  password: 'mypass',
  robotIP: '10.0.0.5',
  robotPort: 8883,
  firmwareVersion: 1,
  enableLocal: 'yes',
  enableCloud: 'yes',
  keepAlive: 'yes',
  basicAuthUser: null,
  basicAuthPass: null
};

// A stand-in for the dorita980 module returning firmware 1.x style clients.
function fakeDorita () {
  const calls = [];
  const record = (name, result) => (args) => {
    calls.push({ name, args });
    return Promise.resolve(result);
  };
  const local = {
    start: record('start', { ok: null }),
    stop: record('stop', { ok: null }),
    getMission: record('getMission', { ok: { phase: 'charge', batPct: 90 } }),
    getWeek: record('getWeek', { ok: { cycle: [], h: [], m: [] } }),
    setWeek: record('setWeek', { ok: null }),
    getTime: () => Promise.reject(new Error('robot said no'))
  };
  const cloud = { getStatus: record('cloud.getStatus', { cloud: true }) };
  return {
    calls,
    Local: (blid, password, ip, version) => {
      calls.push({ name: 'Local', args: [blid, password, ip, version] });
      return local;
    },
    Cloud: () => cloud,
    getRobotIP: (cb) => cb(null, '10.0.0.9')
  };
}

function setup (overrides) {
  const config = Object.assign({}, baseConfig, overrides);
  const dorita = fakeDorita();
  const robot = new Robot(config, { dorita, timeoutMs: 200 });
  robot.start();
  const app = createApp({ config, robot, log: false });
  const request = (path, init) => app.fetch(new Request('http://localhost' + path, init));
  return { app, robot, dorita, request };
}

describe('rest980 app', () => {
  it('answers ping', async () => {
    const { request } = setup();
    const res = await request('/ping');
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty('pong');
  });

  it('serves JSON on / for API clients and the web UI for browsers', async () => {
    const { request } = setup();
    const api = await request('/');
    expect(api.headers.get('content-type')).toContain('application/json');
    const html = await request('/', { headers: { Accept: 'text/html' } });
    expect(html.headers.get('content-type')).toContain('text/html');
    expect(await html.text()).toContain('<title>');
  });

  it('serves static web files', async () => {
    const { request } = setup();
    const res = await request('/app.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
  });

  it('does not serve files outside web/', async () => {
    const { request } = setup();
    expect((await request('/../package.json')).status).toBe(404);
    expect((await request('/%2e%2e/package.json')).status).toBe(404);
  });

  it('returns rest980 style 404 errors', async () => {
    const { request } = setup();
    const res = await request('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: 'Endpoint not found.', error: {} });
  });

  it('reports versions, protocol and capabilities', async () => {
    const { request } = setup();
    const version = await (await request('/api/info/version')).json();
    expect(version.dorita980).toBe(require('../package.json').version);
    expect(version.firmwareVersion).toBe(1);

    const protocol = await (await request('/api/info/protocol')).json();
    expect(protocol).toEqual({ firmwareVersion: 1, protocol: 'v1', transport: 'https-umi', keepAlive: true, robotIP: '10.0.0.5' });

    const capabilities = await (await request('/api/info/capabilities')).json();
    expect(capabilities.cloud).toBe(true);
    expect(capabilities.live).toBe(false);
    expect(capabilities.actions).toEqual(['start', 'pause', 'stop', 'resume', 'dock']);
  });

  it('maps local actions to dorita980 methods with GET and POST', async () => {
    const { request, dorita } = setup();
    expect(await (await request('/api/local/action/start')).json()).toEqual({ ok: null });
    expect(await (await request('/api/local/action/stop', { method: 'POST' })).json()).toEqual({ ok: null });
    expect(dorita.calls.map((c) => c.name)).toContain('stop');
  });

  it('passes JSON bodies as arguments', async () => {
    const { request, dorita } = setup();
    const week = { cycle: ['none'], h: [9], m: [30] };
    const res = await request('/api/local/config/week', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(week)
    });
    expect(res.status).toBe(200);
    expect(dorita.calls.find((c) => c.name === 'setWeek').args).toEqual(week);
  });

  it('passes form bodies as arguments', async () => {
    const { request, dorita } = setup();
    await request('/api/local/config/week', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'a=1&b=two'
    });
    expect(dorita.calls.find((c) => c.name === 'setWeek').args).toEqual({ a: '1', b: 'two' });
  });

  it('rejects calls that need a body without one', async () => {
    const { request } = setup();
    const res = await request('/api/local/config/week', { method: 'POST' });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe('Invalid arguments.');
  });

  it('returns robot errors as JSON', async () => {
    const { request } = setup();
    const res = await request('/api/local/config/time');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ message: 'robot said no', error: {} });
  });

  it('returns 501 for methods the firmware lacks', async () => {
    const { request } = setup();
    const res = await request('/api/local/action/find', { method: 'POST' });
    expect(res.status).toBe(501);
  });

  it('maps cloud routes for firmware 1', async () => {
    const { request } = setup();
    expect(await (await request('/api/cloud/info/status')).json()).toEqual({ cloud: true });
  });

  it('refuses cloud calls when the cloud API is disabled', async () => {
    const { request } = setup({ enableCloud: 'no' });
    expect((await request('/api/cloud/info/status')).status).toBe(503);
  });

  it('refuses local calls when the local API is disabled', async () => {
    const { request } = setup({ enableLocal: 'no' });
    expect((await request('/api/local/action/start')).status).toBe(503);
  });

  it('discovers the robot IP when none is configured', async () => {
    const { robot, dorita } = setup({ robotIP: '' });
    expect(robot.ip).toBe('10.0.0.9');
    expect(dorita.calls.find((c) => c.name === 'Local').args[2]).toBe('10.0.0.9');
  });

  it('streams status as server-sent events', async () => {
    const { request } = setup();
    const res = await request('/api/events');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body.getReader();
    let text = '';
    while (!text.includes('event: status')) {
      const { value } = await reader.read();
      text += new TextDecoder().decode(value);
    }
    await reader.cancel();
    expect(text).toContain('"connection":"ready"');
  });

  describe('with basic auth', () => {
    const auth = (user, pass) => ({ Authorization: 'Basic ' + Buffer.from(user + ':' + pass).toString('base64') });

    it('requires credentials', async () => {
      const { request } = setup({ basicAuthUser: 'admin', basicAuthPass: 'secret' });
      const res = await request('/api/info/version');
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toContain('Basic');
    });

    it('rejects wrong credentials', async () => {
      const { request } = setup({ basicAuthUser: 'admin', basicAuthPass: 'secret' });
      expect((await request('/ping', { headers: auth('admin', 'nope') })).status).toBe(401);
      expect((await request('/ping', { headers: auth('nope', 'secret') })).status).toBe(401);
    });

    it('accepts the right credentials', async () => {
      const { request } = setup({ basicAuthUser: 'admin', basicAuthPass: 'secret' });
      expect((await request('/ping', { headers: auth('admin', 'secret') })).status).toBe(200);
    });
  });
});
