import { describe, it, expect, afterEach } from 'bun:test';
import { resolveCiphers, robotTlsOptions } from '../lib/tls.ts';

const env = Object.assign({}, process.env);

afterEach(() => {
  process.env.ROBOT_CIPHERS = env.ROBOT_CIPHERS;
  if (env.ROBOT_CIPHERS === undefined) delete process.env.ROBOT_CIPHERS;
  process.env.ROBOT_TLS_LEGACY = env.ROBOT_TLS_LEGACY;
  if (env.ROBOT_TLS_LEGACY === undefined) delete process.env.ROBOT_TLS_LEGACY;
});

describe('resolveCiphers', () => {
  it('keeps ciphers supported by the runtime and joins them with colons', () => {
    expect(resolveCiphers('AES128-SHA, AES256-SHA')).toBe('AES128-SHA:AES256-SHA');
  });

  it('drops unknown ciphers', () => {
    expect(resolveCiphers('NOT-A-CIPHER:AES128-SHA')).toBe('AES128-SHA');
  });

  it('returns undefined when nothing is supported', () => {
    expect(resolveCiphers('NOT-A-CIPHER')).toBeUndefined();
    expect(resolveCiphers('')).toBeUndefined();
  });

  it('handles AES128-SHA256 according to the runtime', () => {
    // BoringSSL (Bun) does not support it, OpenSSL (Node.js) does.
    const expected = process.versions.bun ? undefined : 'AES128-SHA256';
    expect(resolveCiphers('AES128-SHA256')).toBe(expected);
  });
});

describe('robotTlsOptions', () => {
  it('does not verify the robot certificate', () => {
    expect(robotTlsOptions().rejectUnauthorized).toBe(false);
  });

  it('prefers ROBOT_CIPHERS over custom options', () => {
    process.env.ROBOT_CIPHERS = 'AES256-SHA';
    expect(robotTlsOptions({ ciphers: 'AES128-SHA' }).ciphers).toBe('AES256-SHA');
  });

  it('uses custom ciphers', () => {
    delete process.env.ROBOT_CIPHERS;
    expect(robotTlsOptions({ ciphers: 'AES128-SHA' }).ciphers).toBe('AES128-SHA');
  });

  it('uses custom secureOptions', () => {
    expect(robotTlsOptions({ secureOptions: 0 }).secureOptions).toBe(0);
  });

  it('can disable legacy renegotiation', () => {
    process.env.ROBOT_TLS_LEGACY = '0';
    expect(robotTlsOptions().secureOptions).toBeUndefined();
  });
});
