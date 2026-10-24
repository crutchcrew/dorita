import { describe, it, expect } from 'bun:test';
import * as dorita980 from '../index.ts';

describe('dorita980 module', () => {
  it('should return an object with functions', () => {
    expect(typeof dorita980).toBe('object');
    expect(dorita980).toHaveProperty('Cloud');
    expect(dorita980).toHaveProperty('Local');
    expect(dorita980).toHaveProperty('getRobotIP');
    expect(dorita980.Cloud).toBeInstanceOf(Function);
    expect(dorita980.Local).toBeInstanceOf(Function);
    expect(dorita980.getRobotIP).toBeInstanceOf(Function);
  });

  it('should also export them as the default object', () => {
    expect(dorita980.default.Local).toBe(dorita980.Local);
    expect(dorita980.default.Cloud).toBe(dorita980.Cloud);
    expect(dorita980.default.getRobotIP).toBe(dorita980.getRobotIP);
  });
});
