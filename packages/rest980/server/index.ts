import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { createApp } from './app.ts';
import type { App } from './app.ts';
import { Robot } from './robot.ts';
import { loadConfig, validateConfig } from './config.ts';
import type { Config } from './config.ts';

export type { Config } from './config.ts';
export type { RobotStatus } from './robot.ts';

interface RunningServer {
  port: number;
  stop: () => Promise<void>;
}

export interface StartServerOptions {
  config?: Config;
  robot?: Robot;
  log?: ((line: string) => void) | false;
  // Use node:http even when running on Bun (for tests).
  useNodeHttp?: boolean;
}

export interface Server {
  port: number;
  url: string;
  robot: Robot;
  stop: () => Promise<void>;
}

// Serves a fetch-style handler with node:http, for running under Node.js
// (e.g. robots that need TLS ciphers Bun lacks).
function serveWithNode(app: App, config: Config): Promise<RunningServer> {
  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const protocol = config.sslKeyFile ? 'https' : 'http';
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const headers = Object.entries(req.headers)
      .filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)
      .map(([key, value]): [string, string] => [key, ([] as string[]).concat(value).join(', ')]);
    const request = new Request(protocol + '://' + (req.headers.host || 'localhost') + req.url, {
      method: req.method,
      headers,
      body: hasBody ? (Readable.toWeb(req) as unknown as ReadableStream) : undefined,
      duplex: hasBody ? 'half' : undefined,
    } as RequestInit);

    const response = await app.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body || req.method === 'HEAD') return void res.end();

    const reader = response.body.getReader();
    res.on('close', () => reader.cancel().catch(() => {}));
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } catch {}
    res.end();
  };

  // node:http ignores the promise, so a throw (e.g. a malformed Host header
  // making new Request() fail) would be an unhandled rejection and crash Node.
  const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end();
    });
  };

  const server =
    config.sslKeyFile && config.sslCertFile
      ? https.createServer(
          { key: fs.readFileSync(config.sslKeyFile), cert: fs.readFileSync(config.sslCertFile) },
          handler,
        )
      : http.createServer(handler);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, () =>
      resolve({
        port: (server.address() as { port: number }).port,
        stop: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      }),
    );
  });
}

function serveWithBun(app: App, config: Config): Promise<RunningServer> {
  const server = Bun.serve({
    port: config.port,
    fetch: app.fetch,
    // Event streams send a keep-alive comment every 15s.
    idleTimeout: 60,
    tls:
      config.sslKeyFile && config.sslCertFile
        ? { key: Bun.file(config.sslKeyFile), cert: Bun.file(config.sslCertFile) }
        : undefined,
  });
  return Promise.resolve({
    port: server.port ?? config.port,
    stop: () => server.stop(true),
  });
}

export async function startServer(options: StartServerOptions = {}): Promise<Server> {
  const config = options.config || loadConfig();
  validateConfig(config);

  const robot = options.robot || new Robot(config);
  const app = createApp({ config, robot, log: options.log });
  const serve = typeof Bun !== 'undefined' && !options.useNodeHttp ? serveWithBun : serveWithNode;
  const server = await serve(app, config);

  robot.start();

  return {
    port: server.port,
    url: (config.sslKeyFile ? 'https' : 'http') + '://localhost:' + server.port,
    robot,
    async stop() {
      robot.stop();
      await server.stop();
    },
  };
}
