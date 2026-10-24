import fs from 'node:fs';
import path from 'node:path';

export type YesNo = 'yes' | 'no' | (string & {});

export interface Config {
  port: number;
  blid: string;
  password: string;
  robotIP: string;
  robotPort: number;
  firmwareVersion: 1 | 2;
  enableLocal: YesNo;
  enableCloud: YesNo;
  keepAlive: YesNo;
  basicAuthUser: string | null;
  basicAuthPass: string | null;
  sslKeyFile: string | null;
  sslCertFile: string | null;
}

export const defaults: Config = {
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
  sslCertFile: null,
};

// Same keys and environment variables as the standalone rest980 server.
const envNames: Record<keyof Config, string> = {
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
  sslCertFile: 'SSL_CERT_FILE',
};

function readConfigFile(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Precedence: environment variables, then the JSON config file
// (CONFIG_FILE, or config/default.json in the working directory), then defaults.
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): Config {
  const file = env.CONFIG_FILE || path.join(cwd, 'config', 'default.json');
  const fromFile = readConfigFile(file);
  const values: Record<string, unknown> = {};

  for (const key of Object.keys(defaults) as (keyof Config)[]) {
    const fromEnv = env[envNames[key]];
    if (fromEnv !== undefined && fromEnv !== '') values[key] = fromEnv;
    else if (fromFile[key] !== undefined && fromFile[key] !== null && fromFile[key] !== '')
      values[key] = fromFile[key];
    else values[key] = defaults[key];
  }

  const config = values as unknown as Config;
  config.port = parseInt(String(values.port), 10);
  config.robotPort = parseInt(String(values.robotPort), 10);
  config.firmwareVersion = parseInt(String(values.firmwareVersion), 10) === 1 ? 1 : 2;
  // The cloud API is not implemented for firmware 2.x.
  if (config.firmwareVersion === 2) config.enableCloud = 'no';

  return config;
}

export function validateConfig(config: Partial<Config>): void {
  if (!config.blid || !config.password) {
    throw new Error(
      'Robot credentials not found. Set BLID and PASSWORD (and ROBOT_IP) environment variables, or put them in config/default.json.',
    );
  }
  if (Boolean(config.basicAuthUser) !== Boolean(config.basicAuthPass)) {
    throw new Error('Both BASIC_AUTH_USER and BASIC_AUTH_PASS must be set to enable basic auth.');
  }
  if (Boolean(config.sslKeyFile) !== Boolean(config.sslCertFile)) {
    throw new Error('Both SSL_KEY_FILE and SSL_CERT_FILE must be set to enable HTTPS.');
  }
}
