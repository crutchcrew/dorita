'use strict';

const fs = require('fs');
const { createApp } = require('./app');
const { Robot } = require('./robot');
const { loadConfig, validateConfig } = require('./config');

// Serves a fetch-style handler with node:http, for running under Node.js
// (e.g. robots that need TLS ciphers Bun lacks).
function serveWithNode (app, config) {
  const http = require('http');
  const https = require('https');
  const { Readable } = require('stream');

  const handler = async (req, res) => {
    const protocol = config.sslKeyFile ? 'https' : 'http';
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const request = new Request(protocol + '://' + (req.headers.host || 'localhost') + req.url, {
      method: req.method,
      headers: Object.entries(req.headers).filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, [].concat(value).join(', ')]),
      body: hasBody ? Readable.toWeb(req) : undefined,
      duplex: hasBody ? 'half' : undefined
    });

    const response = await app.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body || req.method === 'HEAD') return res.end();

    const reader = response.body.getReader();
    res.on('close', () => reader.cancel().catch(() => {}));
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } catch (e) {}
    res.end();
  };

  const server = config.sslKeyFile
    ? https.createServer({ key: fs.readFileSync(config.sslKeyFile), cert: fs.readFileSync(config.sslCertFile) }, handler)
    : http.createServer(handler);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, () => resolve({
      port: server.address().port,
      stop: () => new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      })
    }));
  });
}

function serveWithBun (app, config) {
  /* global Bun */
  const server = Bun.serve({
    port: config.port,
    fetch: app.fetch,
    // Event streams send a keep-alive comment every 15s.
    idleTimeout: 60,
    tls: config.sslKeyFile ? { key: Bun.file(config.sslKeyFile), cert: Bun.file(config.sslCertFile) } : undefined
  });
  return Promise.resolve({
    port: server.port,
    stop: () => server.stop(true)
  });
}

async function startServer (options) {
  options = options || {};
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
    async stop () {
      robot.stop();
      await server.stop();
    }
  };
}

module.exports = { startServer };
