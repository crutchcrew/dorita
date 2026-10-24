'use strict';

const { describe, it, expect } = require('bun:test');
const dorita980 = require('../index');

describe('dorita980 require', () => {
  it('should return an object with functions', () => {
    expect(dorita980).toBeInstanceOf(Object);
    expect(dorita980).toHaveProperty('Cloud');
    expect(dorita980).toHaveProperty('Local');
    expect(dorita980).toHaveProperty('getRobotIP');
    expect(dorita980.Cloud).toBeInstanceOf(Function);
    expect(dorita980.Local).toBeInstanceOf(Function);
    expect(dorita980.getRobotIP).toBeInstanceOf(Function);
  });
});
