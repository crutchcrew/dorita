import fs from 'node:fs';
import net from 'node:net';
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
  // Comma-separated IPs/CIDRs whose requests skip basic auth. When set, other
  // clients need basic auth, and are refused if none is configured.
  trustedNetworks: string | null;
  // A second, plain-HTTP listener for a proxy in front (Home Assistant
  // ingress). When set, trustedNetworks apply only there, and `port` always
  // requires basic auth: a published port can't inherit the proxy's trust.
  internalPort: number | null;
  // Robot TLS settings, also read by dorita980 itself from the same variables.
  robotCiphers: string | null;
  robotTlsMaxVersion: string | null;
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
  trustedNetworks: null,
  internalPort: null,
  robotCiphers: null,
  robotTlsMaxVersion: null,
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
  trustedNetworks: 'TRUSTED_NETWORKS',
  internalPort: 'INTERNAL_PORT',
  robotCiphers: 'ROBOT_CIPHERS',
  robotTlsMaxVersion: 'ROBOT_TLS_MAX_VERSION',
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

  // JSON config files (e.g. Home Assistant's options.json) may use booleans
  // and lists where the environment uses yes/no and comma-separated strings.
  for (const key of ['enableLocal', 'enableCloud', 'keepAlive'] as const) {
    if (typeof values[key] === 'boolean') values[key] = values[key] ? 'yes' : 'no';
  }
  if (Array.isArray(values.trustedNetworks)) {
    // An explicit empty list trusts nobody (a lone comma parses to no entries).
    values.trustedNetworks = values.trustedNetworks.join(',') || ',';
  }

  const config = values as unknown as Config;
  config.port = parseInt(String(values.port), 10);
  config.robotPort = parseInt(String(values.robotPort), 10);
  config.internalPort = values.internalPort ? parseInt(String(values.internalPort), 10) : null;
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
  if (config.trustedNetworks) parseNetworks(config.trustedNetworks);
  if (config.internalPort !== null && config.internalPort !== undefined) {
    const clash = config.internalPort !== 0 && config.internalPort === config.port;
    if (!Number.isInteger(config.internalPort) || clash) {
      throw new Error('INTERNAL_PORT must be a port number different from PORT.');
    }
  }
}

// "172.30.32.0/23, 10.0.0.5" -> a matcher for client addresses. IPv4-mapped
// IPv6 addresses (::ffff:a.b.c.d) match their IPv4 form.
export function parseNetworks(list: string): (address: string | undefined) => boolean {
  const blocks = new net.BlockList();
  for (const entry of list
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)) {
    const [address = '', bits] = entry.split('/');
    const version = net.isIP(address);
    if (!version || (bits !== undefined && !/^\d+$/.test(bits))) {
      throw new Error('TRUSTED_NETWORKS: not an IP address or CIDR: ' + entry);
    }
    const family = version === 6 ? 'ipv6' : 'ipv4';
    if (bits === undefined) blocks.addAddress(address, family);
    else blocks.addSubnet(address, parseInt(bits, 10), family);
  }
  return (address) => {
    if (!address) return false;
    const plain = address.startsWith('::ffff:') ? address.slice(7) : address;
    const version = net.isIP(plain);
    return version !== 0 && blocks.check(plain, version === 6 ? 'ipv6' : 'ipv4');
  };
}
