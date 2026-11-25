import { describe, it, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, validateConfig } from '../server/config.ts';

function tempConfig(contents: Record<string, unknown>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rest980-'));
  fs.mkdirSync(path.join(dir, 'config'));
  fs.writeFileSync(path.join(dir, 'config', 'default.json'), JSON.stringify(contents));
  return dir;
}

describe('loadConfig', () => {
  it('uses defaults', () => {
    const config = loadConfig({}, os.tmpdir());
    expect(config.port).toBe(3000);
    expect(config.robotPort).toBe(8883);
    expect(config.firmwareVersion).toBe(2);
    expect(config.keepAlive).toBe('yes');
    expect(config.enableCloud).toBe('no');
  });

  it('reads config/default.json from the working directory', () => {
    const dir = tempConfig({
      blid: 'fileblid',
      password: 'filepass',
      firmwareVersion: 1,
      port: 8080,
    });
    const config = loadConfig({}, dir);
    expect(config.blid).toBe('fileblid');
    expect(config.password).toBe('filepass');
    expect(config.firmwareVersion).toBe(1);
    expect(config.enableCloud).toBe('yes');
    expect(config.port).toBe(8080);
  });

  it('prefers environment variables over the config file', () => {
    const dir = tempConfig({ blid: 'fileblid', robotIP: '10.0.0.1' });
    const config = loadConfig(
      { BLID: 'envblid', ROBOT_IP: '10.0.0.2', PORT: '4000', FIRMWARE_VERSION: '2' },
      dir,
    );
    expect(config.blid).toBe('envblid');
    expect(config.robotIP).toBe('10.0.0.2');
    expect(config.port).toBe(4000);
  });

  it('reads CONFIG_FILE', () => {
    const dir = tempConfig({ blid: 'custom' });
    const config = loadConfig(
      { CONFIG_FILE: path.join(dir, 'config', 'default.json') },
      os.tmpdir(),
    );
    expect(config.blid).toBe('custom');
  });

  it('reads booleans and lists from JSON, as Home Assistant writes them', () => {
    const dir = tempConfig({ keepAlive: false, enableLocal: true, trustedNetworks: ['a', 'b'] });
    const config = loadConfig({}, dir);
    expect(config.keepAlive).toBe('no');
    expect(config.enableLocal).toBe('yes');
    expect(config.trustedNetworks).toBe('a,b');
    expect(loadConfig({}, tempConfig({ trustedNetworks: [] })).trustedNetworks).toBe(',');
    expect(loadConfig({ TRUSTED_NETWORKS: '10.0.0.0/8' }, dir).trustedNetworks).toBe('10.0.0.0/8');
    const tls = loadConfig(
      {},
      tempConfig({ robotCiphers: 'AES128-SHA256', robotTlsMaxVersion: 'TLSv1.2' }),
    );
    expect([tls.robotCiphers, tls.robotTlsMaxVersion]).toEqual(['AES128-SHA256', 'TLSv1.2']);
  });

  it('ignores empty values', () => {
    const dir = tempConfig({ blid: '', port: null });
    const config = loadConfig({ PASSWORD: '' }, dir);
    expect(config.blid).toBe('');
    expect(config.port).toBe(3000);
  });
});

describe('validateConfig', () => {
  it('requires credentials', () => {
    expect(() => validateConfig({ blid: 'a' })).toThrow(/BLID and PASSWORD/);
  });

  it('requires both SSL files', () => {
    expect(() => validateConfig({ blid: 'a', password: 'b', sslKeyFile: 'key.pem' })).toThrow(
      /SSL_CERT_FILE/,
    );
  });

  it('requires both basic auth values', () => {
    expect(() => validateConfig({ blid: 'a', password: 'b', basicAuthUser: 'admin' })).toThrow(
      /BASIC_AUTH_PASS/,
    );
    expect(() => validateConfig({ blid: 'a', password: 'b', basicAuthPass: 'secret' })).toThrow(
      /BASIC_AUTH_USER/,
    );
  });

  it('rejects trusted networks that are not IPs or CIDRs', () => {
    const base = { blid: 'a', password: 'b' };
    expect(() => validateConfig({ ...base, trustedNetworks: 'homeassistant' })).toThrow(
      /TRUSTED_NETWORKS/,
    );
    expect(() => validateConfig({ ...base, trustedNetworks: '10.0.0.0/x' })).toThrow(
      /TRUSTED_NETWORKS/,
    );
    expect(() => validateConfig({ ...base, trustedNetworks: '10.0.0.0/8/32' })).toThrow(
      /TRUSTED_NETWORKS/,
    );
    expect(() => validateConfig({ ...base, trustedNetworks: '10.0.0.0/8, ::1' })).not.toThrow();
  });

  it('needs the internal port to differ from the main port', () => {
    const base = { blid: 'a', password: 'b', port: 3000 };
    expect(() => validateConfig({ ...base, internalPort: 3000 })).toThrow(/INTERNAL_PORT/);
    expect(() => validateConfig({ ...base, internalPort: 8099 })).not.toThrow();
    expect(loadConfig({ INTERNAL_PORT: '8099' }, os.tmpdir()).internalPort).toBe(8099);
    expect(loadConfig({}, os.tmpdir()).internalPort).toBeNull();
    expect(loadConfig({}, tempConfig({ internalPort: 0 })).internalPort).toBe(0);
  });

  it('rejects an invalid robot TLS version before the server starts', () => {
    const base = { blid: 'a', password: 'b' };
    expect(() => validateConfig({ ...base, robotTlsMaxVersion: '1.2' })).toThrow(
      /ROBOT_TLS_MAX_VERSION/,
    );
    expect(() => validateConfig({ ...base, robotTlsMaxVersion: 'TLSv1.2' })).not.toThrow();
  });

  it('accepts a valid config', () => {
    expect(() => validateConfig({ blid: 'a', password: 'b' })).not.toThrow();
  });
});
