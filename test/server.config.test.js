'use strict';

const { describe, it, expect } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig, validateConfig } = require('../server/config');

function tempConfig (contents) {
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
    const dir = tempConfig({ blid: 'fileblid', password: 'filepass', firmwareVersion: 1, port: 8080 });
    const config = loadConfig({}, dir);
    expect(config.blid).toBe('fileblid');
    expect(config.password).toBe('filepass');
    expect(config.firmwareVersion).toBe(1);
    expect(config.enableCloud).toBe('yes');
    expect(config.port).toBe(8080);
  });

  it('prefers environment variables over the config file', () => {
    const dir = tempConfig({ blid: 'fileblid', robotIP: '10.0.0.1' });
    const config = loadConfig({ BLID: 'envblid', ROBOT_IP: '10.0.0.2', PORT: '4000', FIRMWARE_VERSION: '2' }, dir);
    expect(config.blid).toBe('envblid');
    expect(config.robotIP).toBe('10.0.0.2');
    expect(config.port).toBe(4000);
  });

  it('reads CONFIG_FILE', () => {
    const dir = tempConfig({ blid: 'custom' });
    const config = loadConfig({ CONFIG_FILE: path.join(dir, 'config', 'default.json') }, os.tmpdir());
    expect(config.blid).toBe('custom');
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
    expect(() => validateConfig({ blid: 'a', password: 'b', sslKeyFile: 'key.pem' })).toThrow(/SSL_CERT_FILE/);
  });

  it('requires both basic auth values', () => {
    expect(() => validateConfig({ blid: 'a', password: 'b', basicAuthUser: 'admin' })).toThrow(/BASIC_AUTH_PASS/);
    expect(() => validateConfig({ blid: 'a', password: 'b', basicAuthPass: 'secret' })).toThrow(/BASIC_AUTH_USER/);
  });

  it('accepts a valid config', () => {
    expect(() => validateConfig({ blid: 'a', password: 'b' })).not.toThrow();
  });
});
