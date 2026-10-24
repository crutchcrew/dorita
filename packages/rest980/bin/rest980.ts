#!/usr/bin/env bun

// Starts the REST API and web UI (formerly the standalone rest980 project).
// Configure it with environment variables (Bun also reads .env) or
// config/default.json; see the README.

import { startServer } from '../server/index.ts';
import type { RobotStatus } from '../server/index.ts';

function logStatus(status: RobotStatus): void {
  const error = status.lastError;
  console.log('robot: ' + status.connection + (error ? ' (' + error.message + ')' : ''));
  if (error?.hint) console.log('hint: ' + error.hint);
}

try {
  const server = await startServer();
  console.log('rest980 listening on ' + server.url);

  logStatus(server.robot.status());
  server.robot.on('status', logStatus);

  const shutdown = () => server.stop().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
