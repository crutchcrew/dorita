import tls from 'node:tls';
import { constants } from 'node:crypto';

// The cipher most robots negotiate on the local MQTT/TLS port.
export const DEFAULT_CIPHERS = 'AES128-SHA256';

export interface RobotTlsCustomOptions {
  ciphers?: string;
  secureOptions?: number;
}

export interface RobotTlsOptions {
  rejectUnauthorized: false;
  ciphers?: string;
  secureOptions?: number;
}

function isCipherSupported(cipher: string): boolean {
  try {
    tls.createSecureContext({ ciphers: cipher });
    return true;
  } catch {
    return false;
  }
}

// Keeps only the ciphers the current runtime can use. Bun is built on
// BoringSSL, which does not ship AES128-SHA256, and an unknown cipher makes
// the TLS connect throw synchronously. Returns undefined when nothing is left,
// so the runtime defaults are used instead.
export function resolveCiphers(list: string | undefined): string | undefined {
  const ciphers = String(list || '')
    .split(/[:, ]+/)
    .filter(Boolean);
  const supported = ciphers.filter(isCipherSupported);
  return supported.length ? supported.join(':') : undefined;
}

export function robotTlsOptions(
  customOptions: RobotTlsCustomOptions = {},
  defaultCiphers: string = DEFAULT_CIPHERS,
): RobotTlsOptions {
  const options: RobotTlsOptions = { rejectUnauthorized: false };

  const ciphers = resolveCiphers(
    process.env.ROBOT_CIPHERS || customOptions.ciphers || defaultCiphers,
  );
  if (ciphers) options.ciphers = ciphers;

  if (typeof customOptions.secureOptions !== 'undefined') {
    options.secureOptions = customOptions.secureOptions;
  } else if (process.env.ROBOT_TLS_LEGACY !== '0' && constants?.SSL_OP_LEGACY_SERVER_CONNECT) {
    options.secureOptions = constants.SSL_OP_LEGACY_SERVER_CONNECT;
  }

  return options;
}
