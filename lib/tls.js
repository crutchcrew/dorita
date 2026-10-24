'use strict';

const tls = require('tls');
const { constants } = require('crypto');

// The cipher most robots negotiate on the local MQTT/TLS port.
const DEFAULT_CIPHERS = 'AES128-SHA256';

function isCipherSupported (cipher) {
  try {
    tls.createSecureContext({ ciphers: cipher });
    return true;
  } catch (e) {
    return false;
  }
}

// Keeps only the ciphers the current runtime can use. Bun is built on
// BoringSSL, which does not ship AES128-SHA256, and an unknown cipher makes
// the TLS connect throw synchronously. Returns undefined when nothing is left,
// so the runtime defaults are used instead.
function resolveCiphers (list) {
  const ciphers = String(list || '').split(/[:, ]+/).filter(Boolean);
  const supported = ciphers.filter(isCipherSupported);
  return supported.length ? supported.join(':') : undefined;
}

function robotTlsOptions (customOptions, defaultCiphers) {
  customOptions = customOptions || {};
  const options = { rejectUnauthorized: false };

  const ciphers = resolveCiphers(process.env.ROBOT_CIPHERS || customOptions.ciphers || defaultCiphers || DEFAULT_CIPHERS);
  if (ciphers) options.ciphers = ciphers;

  if (typeof customOptions.secureOptions !== 'undefined') {
    options.secureOptions = customOptions.secureOptions;
  } else if (process.env.ROBOT_TLS_LEGACY !== '0' && constants && constants.SSL_OP_LEGACY_SERVER_CONNECT) {
    options.secureOptions = constants.SSL_OP_LEGACY_SERVER_CONNECT;
  }

  return options;
}

module.exports = {
  DEFAULT_CIPHERS,
  resolveCiphers,
  robotTlsOptions
};
