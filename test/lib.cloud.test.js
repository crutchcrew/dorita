'use strict';

const { describe, it, expect, beforeEach, afterEach, spyOn } = require('bun:test');
const http = require('../lib/http');

var mockRequest = function (options) {
  expect(options.method).toBe('GET');
  expect(options).toHaveProperty('headers');
  expect(options.headers['User-Agent']).toBe('aspen%20production/2618 CFNetwork/758.3.15 Darwin/15.4.0');
  expect(options.headers['Accept']).toBe('*/*');
  expect(options.headers['ASSET-ID'].split('!')[0]).toBe('ElPaso@irobot');

  if (options.headers['ASSET-ID'] === 'ElPaso@irobot!myuser_badjson') {
    return Promise.resolve('bad json');
  }
  return Promise.resolve(JSON.stringify({uri: options.uri}));
};

const Dorita980Cloud = require('../lib/v1/cloud.js');

let requestSpy;
beforeEach(() => {
  requestSpy = spyOn(http, 'request').mockImplementation(mockRequest);
});
afterEach(() => {
  requestSpy.mockRestore();
});

function generateUri (one, two) {
  if (two) one = 'multipleFieldSet&value=%7B%0A%20%20%22remoteCommand%22%20:%20%22' + two + '%22%0A%7D';
  return {'uri': 'https://irobot.axeda.com/services/v1/rest/Scripto/execute/AspenApiRequest?blid=myuser&robotpwd=mypass&method=' + one};
}
describe('dorita980 cloud instance', () => {
  it('should require user/blid', () => {
    expect(function () {
      let viaCloud = new Dorita980Cloud();
      expect(viaCloud).toBeInstanceOf(Object);
    }).toThrow(/robotID is required./);
  });

  it('should require password', () => {
    expect(function () {
      let viaCloud = new Dorita980Cloud('myuser');
      expect(viaCloud).toBeInstanceOf(Object);
    }).toThrow(/password is required./);
  });

  it('should return an object', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    expect(viaCloud).toBeInstanceOf(Object);
  });
});

describe('dorita980 cloud call', () => {
  it('should be rejected if get an invalid json response', () => {
    let viaCloud = new Dorita980Cloud('myuser_badjson', 'mypass');

    return expect(viaCloud.getStatus()).rejects.toThrow(SyntaxError);
  });

  it('should send getStatus command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.getStatus()).resolves.toEqual(generateUri('getStatus'));
  });

  it('should send accumulatedHistorical command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.accumulatedHistorical()).resolves.toEqual(generateUri('accumulatedHistorical'));
  });

  it('should send missionHistory command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.missionHistory()).resolves.toEqual(generateUri('missionHistory'));
  });

  it('should send clean command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.clean()).resolves.toEqual(generateUri('multipleFieldSet', 'clean'));
  });

  it('should send quick command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.quick()).resolves.toEqual(generateUri('multipleFieldSet', 'quick'));
  });

  it('should send spot command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.spot()).resolves.toEqual(generateUri('multipleFieldSet', 'spot'));
  });

  it('should send dock command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.dock()).resolves.toEqual(generateUri('multipleFieldSet', 'dock'));
  });

  it('should send start command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.start()).resolves.toEqual(generateUri('multipleFieldSet', 'start'));
  });

  it('should send pause command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.pause()).resolves.toEqual(generateUri('multipleFieldSet', 'pause'));
  });

  it('should send resume command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.resume()).resolves.toEqual(generateUri('multipleFieldSet', 'resume'));
  });

  it('should send stop command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.stop()).resolves.toEqual(generateUri('multipleFieldSet', 'stop'));
  });

  it('should send wake command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.wake()).resolves.toEqual(generateUri('multipleFieldSet', 'wake'));
  });

  it('should send reset command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.reset()).resolves.toEqual(generateUri('multipleFieldSet', 'reset'));
  });

  it('should send find command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.find()).resolves.toEqual(generateUri('multipleFieldSet', 'find'));
  });

  it('should send wipe command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.wipe()).resolves.toEqual(generateUri('multipleFieldSet', 'wipe'));
  });

  it('should send patch command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.patch()).resolves.toEqual(generateUri('multipleFieldSet', 'patch'));
  });

  it('should send dlpkg command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.dlpkg()).resolves.toEqual(generateUri('multipleFieldSet', 'dlpkg'));
  });

  it('should send rechrg command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.rechrg()).resolves.toEqual(generateUri('multipleFieldSet', 'rechrg'));
  });

  it('should send wlapon command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.wlapon()).resolves.toEqual(generateUri('multipleFieldSet', 'wlapon'));
  });

  it('should send wlapoff command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.wlapoff()).resolves.toEqual(generateUri('multipleFieldSet', 'wlapoff'));
  });

  it('should send wlston command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.wlston()).resolves.toEqual(generateUri('multipleFieldSet', 'wlston'));
  });

  it('should send wlstoff command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.wlstoff()).resolves.toEqual(generateUri('multipleFieldSet', 'wlstoff'));
  });

  it('should send wifiscan command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.wifiscan()).resolves.toEqual(generateUri('multipleFieldSet', 'wifiscan'));
  });

  it('should send ipdone command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.ipdone()).resolves.toEqual(generateUri('multipleFieldSet', 'ipdone'));
  });

  it('should send provdone command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.provdone()).resolves.toEqual(generateUri('multipleFieldSet', 'provdone'));
  });

  it('should send bye command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.bye()).resolves.toEqual(generateUri('multipleFieldSet', 'bye'));
  });

  it('should send wllogflush command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.wllogflush()).resolves.toEqual(generateUri('multipleFieldSet', 'wllogflush'));
  });

  it('should send sleep command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.sleep()).resolves.toEqual(generateUri('multipleFieldSet', 'sleep'));
  });

  it('should send off command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.off()).resolves.toEqual(generateUri('multipleFieldSet', 'off'));
  });

  it('should send fbeep command', () => {
    let viaCloud = new Dorita980Cloud('myuser', 'mypass');
    return expect(viaCloud.fbeep()).resolves.toEqual(generateUri('multipleFieldSet', 'fbeep'));
  });
});
