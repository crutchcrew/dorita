'use strict';

const fs = require('fs');
const path = require('path');

const defaults = {
  port: 3000,
  blid: '',
  password: '',
  robotIP: '',
  robotPort: 8883,
  firmwareVersion: 2,
  enableLocal: 'yes',
  enableCloud: 'yes',
  keepAlive: 'yes',
  basicAuthUser: null,
  basicAuthPass: null,
  sslKeyFile: null,
  sslCertFile: null
};

// Same keys and environment variables as the standalone rest980 server.
const envNames = {
  port: 'PORT',
  blid: 'BLID',
  password: 'PASSWORD',
  robotIP: 'ROBOT_IP',
  robotPort: 'ROBOT_PORT',
  firmwareVersion: 'FIRMWARE_VERSION',
  enableLocal: 'ENABLE_LOCAL',
  enableCloud: 'ENABLE_CLOUD',
  keepAlive: 'KEEP_ALIVE',
  basicAuthUser: 'BASIC_AUTH_USER',
  basicAuthPass: 'BASIC_AUTH_PASS',
  sslKeyFile: 'SSL_KEY_FILE',
  sslCertFile: 'SSL_CERT_FILE'
};

function readConfigFile (file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Precedence: environment variables, then the JSON config file
// (CONFIG_FILE, or config/default.json in the working directory), then defaults.
function loadConfig (env, cwd) {
  env = env || process.env;
  const file = env.CONFIG_FILE || path.join(cwd || process.cwd(), 'config', 'default.json');
  const fromFile = readConfigFile(file);
  const config = {};

  for (const key of Object.keys(defaults)) {
    const fromEnv = env[envNames[key]];
    if (fromEnv !== undefined && fromEnv !== '') config[key] = fromEnv;
    else if (fromFile[key] !== undefined && fromFile[key] !== null && fromFile[key] !== '') config[key] = fromFile[key];
    else config[key] = defaults[key];
  }

  config.port = parseInt(config.port, 10);
  config.robotPort = parseInt(config.robotPort, 10);
  config.firmwareVersion = parseInt(config.firmwareVersion, 10) === 1 ? 1 : 2;
  // The cloud API is not implemented for firmware 2.x.
  if (config.firmwareVersion === 2) config.enableCloud = 'no';

  return config;
}

function validateConfig (config) {
  if (!config.blid || !config.password) {
    throw new Error('Robot credentials not found. Set BLID and PASSWORD (and ROBOT_IP) environment variables, or put them in config/default.json.');
  }
  if (Boolean(config.basicAuthUser) !== Boolean(config.basicAuthPass)) {
    throw new Error('Both BASIC_AUTH_USER and BASIC_AUTH_PASS must be set to enable basic auth.');
  }
  if (Boolean(config.sslKeyFile) !== Boolean(config.sslCertFile)) {
    throw new Error('Both SSL_KEY_FILE and SSL_CERT_FILE must be set to enable HTTPS.');
  }
}

module.exports = {
  defaults,
  loadConfig,
  validateConfig
};
