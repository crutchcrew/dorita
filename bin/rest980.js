#!/usr/bin/env bun

'use strict';

// Starts the REST API and web UI (formerly the standalone rest980 project).
// Configure it with environment variables (Bun also reads .env) or
// config/default.json; see the README.

const { startServer } = require('../server');

startServer().then((server) => {
  console.log('rest980 listening on ' + server.url);
  const logStatus = (status) => {
    console.log('robot: ' + status.connection + (status.lastError ? ' (' + status.lastError.message + ')' : ''));
    if (status.lastError && status.lastError.hint) console.log('hint: ' + status.lastError.hint);
  };
  logStatus(server.robot.status());
  server.robot.on('status', logStatus);

  const shutdown = () => server.stop().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
