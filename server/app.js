'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const routes = require('./api');
const pkg = require('../package.json');

const WEB_DIR = path.join(__dirname, '..', 'web');
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json'
};
const STATE_THROTTLE_MS = 300;
const SSE_KEEPALIVE_MS = 15000;

function json (body, status, headers) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers)
  });
}

function errorResponse (status, message) {
  return json({ message, error: {} }, status);
}

function safeEqual (a, b) {
  const hash = (value) => crypto.createHash('sha256').update(String(value)).digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

function checkBasicAuth (request, user, pass) {
  const header = request.headers.get('authorization') || '';
  const match = /^Basic\s+(.+)$/i.exec(header);
  if (!match) return false;
  const decoded = Buffer.from(match[1], 'base64').toString();
  const separator = decoded.indexOf(':');
  if (separator < 0) return false;
  // Compare both parts unconditionally to avoid leaking which one was wrong.
  const userOk = safeEqual(decoded.slice(0, separator), user);
  const passOk = safeEqual(decoded.slice(separator + 1), pass);
  return userOk && passOk;
}

async function readBody (request) {
  const text = await request.text();
  if (!text) return undefined;
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    return undefined;
  }
}

// Only files that exist in web/ when the server starts are served.
function loadStaticFiles () {
  const files = new Map();
  if (!fs.existsSync(WEB_DIR)) return files;
  for (const name of fs.readdirSync(WEB_DIR)) {
    const file = path.join(WEB_DIR, name);
    if (fs.statSync(file).isFile()) files.set('/' + name, file);
  }
  return files;
}

async function serveStatic (file) {
  const body = await fs.promises.readFile(file);
  return new Response(body, {
    headers: {
      'Content-Type': CONTENT_TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    }
  });
}

function eventStream (robot) {
  const encoder = new TextEncoder();
  let cleanup;

  const stream = new ReadableStream({
    start (controller) {
      let stateTimer = null;
      let pendingState = false;

      const send = (event, data) => {
        try {
          controller.enqueue(encoder.encode('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'));
        } catch (e) {
          if (cleanup) cleanup();
        }
      };

      // The robot publishes many small updates; send at most one full
      // state snapshot every STATE_THROTTLE_MS.
      const flushState = () => {
        stateTimer = null;
        if (pendingState && robot.state) {
          pendingState = false;
          send('state', robot.state);
          stateTimer = setTimeout(flushState, STATE_THROTTLE_MS);
        }
      };
      const onState = () => {
        pendingState = true;
        if (!stateTimer) flushState();
      };
      const onStatus = (status) => send('status', status);
      const onMission = (mission) => send('mission', mission);
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch (e) {
          cleanup();
        }
      }, SSE_KEEPALIVE_MS);

      robot.on('state', onState);
      robot.on('status', onStatus);
      robot.on('mission', onMission);

      cleanup = () => {
        clearInterval(keepAlive);
        clearTimeout(stateTimer);
        robot.off('state', onState);
        robot.off('status', onStatus);
        robot.off('mission', onMission);
      };

      controller.enqueue(encoder.encode('retry: 3000\n\n'));
      send('status', robot.status());
      if (robot.state) send('state', robot.state);
    },
    cancel () {
      if (cleanup) cleanup();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
}

// Builds the rest980 HTTP handler as a fetch-style function
// (Request -> Response) so it can run on Bun.serve or node:http.
function createApp (options) {
  const config = options.config;
  const robot = options.robot;
  const log = options.log === undefined ? console.log : options.log;
  const staticFiles = loadStaticFiles();
  const authEnabled = Boolean(config.basicAuthUser && config.basicAuthPass);

  const table = new Map();
  const add = (method, routePath, handler) => table.set(method + ' ' + routePath, handler);

  const hello = () => json({ documentation: 'https://github.com/koalazak/dorita980#rest-api', pong: new Date() });

  add('GET', '/', (request) => {
    const accept = request.headers.get('accept') || '';
    if (accept.includes('text/html') && staticFiles.has('/index.html')) return serveStatic(staticFiles.get('/index.html'));
    return hello();
  });
  add('GET', '/ping', hello);

  add('GET', '/api', () => json({ version: '1.0.' + robot.firmwareVersion }));
  add('GET', '/api/info/version', () => json({
    rest980: pkg.version,
    dorita980: pkg.version,
    node: process.version,
    bun: process.versions.bun || null,
    firmwareVersion: robot.firmwareVersion
  }));
  add('GET', '/api/info/protocol', () => json({
    firmwareVersion: robot.firmwareVersion,
    protocol: robot.firmwareVersion === 1 ? 'v1' : 'v2',
    transport: robot.firmwareVersion === 1 ? 'https-umi' : 'mqtt-tls',
    keepAlive: robot.keepAlive,
    robotIP: robot.ip || null
  }));
  add('GET', '/api/info/capabilities', () => json({
    local: robot.localEnabled,
    cloud: robot.cloudEnabled,
    state: robot.firmwareVersion === 2,
    keepAlive: robot.keepAlive,
    live: robot.live,
    actions: robot.actions,
    missingInFirmware2: ['setTime', 'setPtime']
  }));
  add('GET', '/api/status', () => json(Object.assign(robot.status(), { state: robot.state, path: robot.path })));
  add('DELETE', '/api/path', () => {
    robot.clearPath();
    return json({ ok: null });
  });
  add('GET', '/api/events', () => eventStream(robot));

  for (const route of routes) {
    if (route.onlyFirmware && route.onlyFirmware !== robot.firmwareVersion) continue;
    const handler = async (request) => {
      let args;
      if (route.hasArgs) {
        args = await readBody(request);
        if (args === undefined) return errorResponse(400, 'Invalid arguments.');
      }
      return json(await robot.call(route.source, route.method, args));
    };
    for (const method of route.methods) add(method, route.path, handler);
  }

  async function handle (request, url) {
    if (authEnabled && !checkBasicAuth(request, config.basicAuthUser, config.basicAuthPass)) {
      return new Response('Unauthorized', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="rest980"' }
      });
    }

    const method = request.method === 'HEAD' ? 'GET' : request.method;
    const handler = table.get(method + ' ' + url.pathname);
    if (handler) {
      try {
        return await handler(request);
      } catch (error) {
        return errorResponse(error.status || 500, error.message || String(error));
      }
    }

    if (method === 'GET' && staticFiles.has(url.pathname)) return serveStatic(staticFiles.get(url.pathname));
    return errorResponse(404, 'Endpoint not found.');
  }

  return {
    async fetch (request) {
      const started = Date.now();
      let url;
      let response;
      try {
        // With a malformed Host header Bun.serve passes a relative URL.
        url = new URL(request.url, 'http://localhost');
        response = await handle(request, url);
      } catch (error) {
        response = url ? errorResponse(500, error.message || String(error)) : errorResponse(400, 'Bad request.');
      }
      if (log) log(request.method + ' ' + (url ? url.pathname : request.url) + ' ' + response.status + ' ' + (Date.now() - started) + 'ms');
      return response;
    }
  };
}

module.exports = { createApp };
