import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { routes } from './api.ts';
import type { Config } from './config.ts';
import type { Robot, RobotStatus } from './robot.ts';
import type { MissionUpdate } from '../lib/types.ts';

const WEB_DIR = path.join(import.meta.dirname, '..', 'web');
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};
const STATE_THROTTLE_MS = 300;
const SSE_KEEPALIVE_MS = 15000;

type Handler = (request: Request) => Response | Promise<Response>;

export interface App {
  fetch: (request: Request) => Promise<Response>;
}

export interface AppOptions {
  config: Config;
  robot: Robot;
  log?: ((line: string) => void) | false;
}

// The package version, read from the nearest package.json so it works both
// from the sources and from the compiled dist/ folder.
function packageVersion(): string {
  let dir = import.meta.dirname;
  for (;;) {
    const file = path.join(dir, 'package.json');
    if (fs.existsSync(file)) {
      const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (pkg.name === 'dorita980') return pkg.version;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return 'unknown';
    dir = parent;
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

function hello(): Response {
  return json({
    documentation: 'https://github.com/koalazak/dorita980#rest-api',
    pong: new Date(),
  });
}

function errorResponse(status: number, message: string): Response {
  return json({ message, error: {} }, status);
}

function sha256(value: string): Buffer {
  return crypto.createHash('sha256').update(value).digest();
}

function safeEqual(a: string, b: string): boolean {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

function checkBasicAuth(request: Request, user: string, pass: string): boolean {
  const header = request.headers.get('authorization') || '';
  const match = /^Basic\s+(.+)$/i.exec(header);
  if (!match?.[1]) return false;
  const decoded = Buffer.from(match[1], 'base64').toString();
  const separator = decoded.indexOf(':');
  if (separator < 0) return false;
  // Compare both parts unconditionally to avoid leaking which one was wrong.
  const userOk = safeEqual(decoded.slice(0, separator), user);
  const passOk = safeEqual(decoded.slice(separator + 1), pass);
  return userOk && passOk;
}

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text) return undefined;
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// The web UI script is TypeScript in the sources; strip its types when it is
// served. The compiled dist/ folder ships plain JavaScript instead.
async function stripTypes(source: string): Promise<string> {
  if (typeof Bun !== 'undefined') return new Bun.Transpiler({ loader: 'ts' }).transformSync(source);
  const nodeModule = (await import('node:module')) as {
    stripTypeScriptTypes?: (code: string) => string;
  };
  if (!nodeModule.stripTypeScriptTypes) {
    throw new Error('Serving the web UI from sources needs Bun or Node.js 22.13+.');
  }
  return nodeModule.stripTypeScriptTypes(source);
}

interface StaticFile {
  file: string;
  type: string;
  transpile: boolean;
}

// Only files that exist in web/ when the server starts are served.
function loadStaticFiles(): Map<string, StaticFile> {
  const files = new Map<string, StaticFile>();
  if (!fs.existsSync(WEB_DIR)) return files;
  for (const name of fs.readdirSync(WEB_DIR)) {
    const file = path.join(WEB_DIR, name);
    if (!fs.statSync(file).isFile()) continue;
    const ext = path.extname(name);
    if (ext === '.ts' && !name.endsWith('.d.ts')) {
      const urlPath = '/' + name.slice(0, -3) + '.js';
      if (!files.has(urlPath)) {
        files.set(urlPath, { file, type: CONTENT_TYPES['.js']!, transpile: true });
      }
    } else if (CONTENT_TYPES[ext]) {
      files.set('/' + name, { file, type: CONTENT_TYPES[ext], transpile: false });
    }
  }
  return files;
}

const transpiled = new Map<string, Promise<string>>();

async function serveStatic(entry: StaticFile): Promise<Response> {
  let body: string | Buffer;
  if (entry.transpile) {
    if (!transpiled.has(entry.file)) {
      transpiled.set(entry.file, fs.promises.readFile(entry.file, 'utf8').then(stripTypes));
    }
    body = await transpiled.get(entry.file)!;
  } else {
    body = await fs.promises.readFile(entry.file);
  }
  return new Response(body, {
    headers: { 'Content-Type': entry.type, 'Cache-Control': 'no-cache' },
  });
}

function eventStream(robot: Robot): Response {
  const encoder = new TextEncoder();
  let cleanup: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let stateTimer: ReturnType<typeof setTimeout> | null = null;
      let pendingState = false;

      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'),
          );
        } catch {
          cleanup?.();
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
      const onStatus = (status: RobotStatus) => send('status', status);
      const onMission = (mission: MissionUpdate) => send('mission', mission);
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          cleanup?.();
        }
      }, SSE_KEEPALIVE_MS);

      robot.on('state', onState);
      robot.on('status', onStatus);
      robot.on('mission', onMission);

      cleanup = () => {
        clearInterval(keepAlive);
        if (stateTimer) clearTimeout(stateTimer);
        robot.off('state', onState);
        robot.off('status', onStatus);
        robot.off('mission', onMission);
      };

      controller.enqueue(encoder.encode('retry: 3000\n\n'));
      send('status', robot.status());
      if (robot.state) send('state', robot.state);
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// Builds the rest980 HTTP handler as a fetch-style function
// (Request -> Response) so it can run on Bun.serve or node:http.
export function createApp(options: AppOptions): App {
  const { config, robot } = options;
  const log = options.log === undefined ? console.log : options.log;
  const staticFiles = loadStaticFiles();
  const version = packageVersion();
  const basicAuth =
    config.basicAuthUser && config.basicAuthPass
      ? { user: config.basicAuthUser, pass: config.basicAuthPass }
      : null;

  const table = new Map<string, Handler>();
  const add = (method: string, routePath: string, handler: Handler) =>
    table.set(method + ' ' + routePath, handler);

  add('GET', '/', (request) => {
    const accept = request.headers.get('accept') || '';
    const index = staticFiles.get('/index.html');
    if (accept.includes('text/html') && index) return serveStatic(index);
    return hello();
  });
  add('GET', '/ping', hello);

  add('GET', '/api', () => json({ version: '1.0.' + robot.firmwareVersion }));
  add('GET', '/api/info/version', () =>
    json({
      rest980: version,
      dorita980: version,
      node: process.version,
      bun: process.versions.bun || null,
      firmwareVersion: robot.firmwareVersion,
    }),
  );
  add('GET', '/api/info/protocol', () =>
    json({
      firmwareVersion: robot.firmwareVersion,
      protocol: robot.firmwareVersion === 1 ? 'v1' : 'v2',
      transport: robot.firmwareVersion === 1 ? 'https-umi' : 'mqtt-tls',
      keepAlive: robot.keepAlive,
      robotIP: robot.ip || null,
    }),
  );
  add('GET', '/api/info/capabilities', () =>
    json({
      local: robot.localEnabled,
      cloud: robot.cloudEnabled,
      state: robot.firmwareVersion === 2,
      keepAlive: robot.keepAlive,
      live: robot.live,
      actions: robot.actions,
      missingInFirmware2: ['setTime', 'setPtime'],
    }),
  );
  add('GET', '/api/status', () =>
    json({ ...robot.status(), state: robot.state, path: robot.path }),
  );
  add('DELETE', '/api/path', () => {
    robot.clearPath();
    return json({ ok: null });
  });
  add('GET', '/api/events', () => eventStream(robot));

  for (const route of routes) {
    if (route.onlyFirmware && route.onlyFirmware !== robot.firmwareVersion) continue;
    const handler: Handler = async (request) => {
      let args: unknown;
      if (route.hasArgs) {
        args = await readBody(request);
        if (args === undefined) return errorResponse(400, 'Invalid arguments.');
      }
      return json(await robot.call(route.source, route.method, args));
    };
    for (const method of route.methods) add(method, route.path, handler);
  }

  async function handle(request: Request, url: URL): Promise<Response> {
    if (basicAuth && !checkBasicAuth(request, basicAuth.user, basicAuth.pass)) {
      return new Response('Unauthorized', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="rest980"' },
      });
    }

    const method = request.method === 'HEAD' ? 'GET' : request.method;
    const handler = table.get(method + ' ' + url.pathname);
    if (handler) {
      try {
        return await handler(request);
      } catch (error) {
        const err = error as Error & { status?: number };
        return errorResponse(err.status || 500, err.message || String(error));
      }
    }

    const file = staticFiles.get(url.pathname);
    if (method === 'GET' && file) return serveStatic(file);
    return errorResponse(404, 'Endpoint not found.');
  }

  return {
    async fetch(request) {
      const started = Date.now();
      let url: URL | undefined;
      let response: Response;
      try {
        // With a malformed Host header Bun.serve passes a relative URL.
        url = new URL(request.url, 'http://localhost');
        response = await handle(request, url);
      } catch (error) {
        response = url
          ? errorResponse(500, (error as Error).message || String(error))
          : errorResponse(400, 'Bad request.');
      }
      if (log) {
        const pathname = url ? url.pathname : request.url;
        log(`${request.method} ${pathname} ${response.status} ${Date.now() - started}ms`);
      }
      return response;
    },
  };
}
