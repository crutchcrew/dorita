import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { httpClient } from '../lib/http.ts';

const mockRequest = function (options: any): Promise<string> {
  expect(options.method).toBe('POST');
  expect(options).toHaveProperty('headers');
  expect(options.headers['User-Agent']).toBe(
    'aspen%20production/2618 CFNetwork/758.3.15 Darwin/15.4.0',
  );
  expect(options.headers['Accept']).toBe('*/*');
  expect(options.headers['Content-Type']).toBe('application/json');
  expect(options.uri).toBe('https://192.168.1.104:443/umi');
  expect(options.headers).toHaveProperty('Authorization');

  switch (options.headers['Authorization'].split(' ')[1]) {
    case Buffer.from('user:123456_bad').toString('base64'):
      return Promise.resolve('bad json');
    case Buffer.from('user:123456_getprefs_err').toString('base64'):
      return Promise.resolve(JSON.stringify({ error: -12345, body: options.body }));
    case Buffer.from('user:123456_getmission_err').toString('base64'):
      return Promise.resolve(JSON.stringify({ error: -12345, body: options.body }));
    case Buffer.from('user:123456_getprefs').toString('base64'):
      if (JSON.parse(options.body).do === 'get') {
        let resp = {
          ok: {
            flags: 1024,
            lang: 2,
            timezone: 'America/Buenos_Aires',
            name: 'myRobotName',
          },
          id: 2,
          body: options.body,
        };
        return Promise.resolve(JSON.stringify(resp));
      } else {
        return Promise.resolve(JSON.stringify({ ok: null, body: options.body }));
      }
    case Buffer.from('user:123456_getmission').toString('base64'): {
      let resp = {
        ok: {
          flags: 4,
        },
        id: 2,
        body: options.body,
      };
      return Promise.resolve(JSON.stringify(resp));
    }
    default:
      expect(options.headers['Authorization']).toBe(
        'Basic ' + Buffer.from('user:mypassword').toString('base64'),
      );
      return Promise.resolve(JSON.stringify({ ok: null, body: options.body }));
  }
};

import Dorita980Local from '../lib/v1/local.ts';

let requestSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
  requestSpy = spyOn(httpClient, 'request').mockImplementation(mockRequest);
});
afterEach(() => {
  requestSpy.mockRestore();
});

function generateBody(method: string, command: string, args?: unknown, rid?: number) {
  rid = rid || 1;
  return (
    '{"do":"' +
    method +
    '","args":["' +
    command +
    '"' +
    (args ? ', ' + JSON.stringify(args) : '') +
    '],"id":' +
    rid +
    '}'
  );
}

describe('dorita980 local instance', () => {
  it('should require user/blid', () => {
    expect(function () {
      // @ts-expect-error -- checks the runtime validation
      let viaLocal = Dorita980Local();
      expect(viaLocal).toBeInstanceOf(Object);
    }).toThrow(/robotID is required./);
  });

  it('should require password', () => {
    expect(function () {
      // @ts-expect-error -- checks the runtime validation
      let viaLocal = Dorita980Local('myblid123');
      expect(viaLocal).toBeInstanceOf(Object);
    }).toThrow(/password is required./);
  });

  it('should require host', () => {
    expect(function () {
      // @ts-expect-error -- checks the runtime validation
      let viaLocal = Dorita980Local('myuser', 'mypassword');
      expect(viaLocal).toBeInstanceOf(Object);
    }).toThrow(/host is required./);
  });

  it('should return an object', () => {
    let viaLocal = Dorita980Local('myuser', 'mypassword', '192.168.1.104');
    expect(viaLocal).toBeInstanceOf(Object);
  });
});

describe('dorita980 Cleaning Preferences helpers', () => {
  it('should return decoded Cleaning Preferences for 1024 flag', () => {
    let viaLocal = Dorita980Local('myuser', 'mypassword', '192.168.1.104');
    let preferences = viaLocal.decodeCleaningPreferences(1024);
    expect(preferences.carpetBoost).toBe('auto');
    expect(preferences.edgeClean).toBe(true);
    expect(preferences.cleaningPasses).toBe('1');
    expect(preferences.alwaysFinish).toBe(true);
  });

  it('should return decoded Cleaning Preferences for 1058 flag', () => {
    let viaLocal = Dorita980Local('myuser', 'mypassword', '192.168.1.104');
    let preferences = viaLocal.decodeCleaningPreferences(1058);
    expect(preferences.carpetBoost).toBe('auto');
    expect(preferences.edgeClean).toBe(false);
    expect(preferences.cleaningPasses).toBe('1');
    expect(preferences.alwaysFinish).toBe(false);
  });

  it('should return decoded Cleaning Preferences for 1105 flag', () => {
    let viaLocal = Dorita980Local('myuser', 'mypassword', '192.168.1.104');
    let preferences = viaLocal.decodeCleaningPreferences(1105);
    expect(preferences.carpetBoost).toBe('performance');
    expect(preferences.edgeClean).toBe(true);
    expect(preferences.cleaningPasses).toBe('2');
    expect(preferences.alwaysFinish).toBe(true);
  });

  it('should return decoded Cleaning Preferences for 1072 flag', () => {
    let viaLocal = Dorita980Local('myuser', 'mypassword', '192.168.1.104');
    let preferences = viaLocal.decodeCleaningPreferences(1072);
    expect(preferences.carpetBoost).toBe('eco');
    expect(preferences.edgeClean).toBe(true);
    expect(preferences.cleaningPasses).toBe('1');
    expect(preferences.alwaysFinish).toBe(false);
  });

  it('should return decoded Cleaning Preferences for 18 flag', () => {
    let viaLocal = Dorita980Local('myuser', 'mypassword', '192.168.1.104');
    let preferences = viaLocal.decodeCleaningPreferences(18);
    expect(preferences.carpetBoost).toBe('eco');
    expect(preferences.edgeClean).toBe(false);
    expect(preferences.cleaningPasses).toBe('auto');
    expect(preferences.alwaysFinish).toBe(true);
  });

  it('should return decoded Cleaning Preferences for 112 flag', () => {
    let viaLocal = Dorita980Local('myuser', 'mypassword', '192.168.1.104');
    let preferences = viaLocal.decodeCleaningPreferences(112);
    expect(preferences.carpetBoost).toBe('performance');
    expect(preferences.edgeClean).toBe(true);
    expect(preferences.cleaningPasses).toBe('auto');
    expect(preferences.alwaysFinish).toBe(false);
  });
});

describe('dorita980 local call', () => {
  it('should be rejected if get an invalid json response', () => {
    let viaLocal = Dorita980Local('myuser', '123456_bad', '192.168.1.104');

    return expect(viaLocal.getTime()).rejects.toThrow(SyntaxError);
  });

  it('should send getPreferences command with default decoded arg', () => {
    let viaLocal = Dorita980Local('myuser', '123456_getprefs', '192.168.1.104');

    let responseOK = {
      ok: {
        cleaningPreferences: {
          alwaysFinish: true,
          carpetBoost: 'auto',
          cleaningPasses: '1',
          edgeClean: true,
        },
        flags: 1024,
        lang: 2,
        name: 'myRobotName',
        timezone: 'America/Buenos_Aires',
      },
      id: 2,
      body: generateBody('get', 'prefs'),
    };

    return expect(viaLocal.getPreferences()).resolves.toEqual(responseOK);
  });

  it('should send getPreferences command with default decoded arg and handle not ok response', () => {
    let viaLocal = Dorita980Local('myuser', '123456_getprefs_err', '192.168.1.104');

    let responseOK = {
      error: -12345,
      body: generateBody('get', 'prefs'),
    };

    return expect(viaLocal.getPreferences()).resolves.toEqual(responseOK);
  });

  it('should send getPreferences command with false decoded arg', () => {
    let viaLocal = Dorita980Local('myuser', '123456_getprefs', '192.168.1.104');

    let responseOK = {
      ok: {
        flags: 1024,
        lang: 2,
        name: 'myRobotName',
        timezone: 'America/Buenos_Aires',
      },
      id: 2,
      body: generateBody('get', 'prefs'),
    };

    return expect(viaLocal.getPreferences(false)).resolves.toEqual(responseOK);
  });

  it('should send setPreferences command', () => {
    let viaLocal = Dorita980Local('myuser', '123456_getprefs', '192.168.1.104');

    let newPreferences = {
      flags: 1107,
      lang: 2,
      timezone: 'America/Buenos_Aires',
      name: 'myRobotName',
    };

    let responseOK = {
      ok: null,
      body: generateBody('set', 'prefs', newPreferences),
    };

    return expect(viaLocal.setPreferences(newPreferences)).resolves.toEqual(responseOK);
  });

  it('should send setCarpetBoostPerformance command', () => {
    let viaLocal = Dorita980Local('myuser', '123456_getprefs', '192.168.1.104');

    let newPreferencesWillbe = {
      flags: 1104,
      lang: 2,
      timezone: 'America/Buenos_Aires',
      name: 'myRobotName',
    };

    let responseOK = {
      ok: null,
      body: generateBody('set', 'prefs', newPreferencesWillbe, 2),
    };

    return expect(viaLocal.setCarpetBoostPerformance()).resolves.toEqual(responseOK);
  });

  it('should send setCarpetBoostEco command', () => {
    let viaLocal = Dorita980Local('myuser', '123456_getprefs', '192.168.1.104');

    let newPreferencesWillbe = {
      flags: 1040,
      lang: 2,
      timezone: 'America/Buenos_Aires',
      name: 'myRobotName',
    };

    let responseOK = {
      ok: null,
      body: generateBody('set', 'prefs', newPreferencesWillbe, 2),
    };

    return expect(viaLocal.setCarpetBoostEco()).resolves.toEqual(responseOK);
  });

  it('should send setCarpetBoostAuto command', () => {
    let viaLocal = Dorita980Local('myuser', '123456_getprefs', '192.168.1.104');

    let newPreferencesWillbe = {
      flags: 1024,
      lang: 2,
      timezone: 'America/Buenos_Aires',
      name: 'myRobotName',
    };

    let responseOK = {
      ok: null,
      body: generateBody('set', 'prefs', newPreferencesWillbe, 2),
    };

    return expect(viaLocal.setCarpetBoostAuto()).resolves.toEqual(responseOK);
  });

  it('should send setEdgeCleanOn command', () => {
    let viaLocal = Dorita980Local('myuser', '123456_getprefs', '192.168.1.104');

    let newPreferencesWillbe = {
      flags: 1024,
      lang: 2,
      timezone: 'America/Buenos_Aires',
      name: 'myRobotName',
    };

    let responseOK = {
      ok: null,
      body: generateBody('set', 'prefs', newPreferencesWillbe, 2),
    };

    return expect(viaLocal.setEdgeCleanOn()).resolves.toEqual(responseOK);
  });

  it('should send setEdgeCleanOff command', () => {
    let viaLocal = Dorita980Local('myuser', '123456_getprefs', '192.168.1.104');

    let newPreferencesWillbe = {
      flags: 1026,
      lang: 2,
      timezone: 'America/Buenos_Aires',
      name: 'myRobotName',
    };

    let responseOK = {
      ok: null,
      body: generateBody('set', 'prefs', newPreferencesWillbe, 2),
    };

    return expect(viaLocal.setEdgeCleanOff()).resolves.toEqual(responseOK);
  });

  it('should send setCleaningPassesAuto command', () => {
    let viaLocal = Dorita980Local('myuser', '123456_getprefs', '192.168.1.104');

    let newPreferencesWillbe = {
      flags: 0,
      lang: 2,
      timezone: 'America/Buenos_Aires',
      name: 'myRobotName',
    };

    let responseOK = {
      ok: null,
      body: generateBody('set', 'prefs', newPreferencesWillbe, 2),
    };

    return expect(viaLocal.setCleaningPassesAuto()).resolves.toEqual(responseOK);
  });

  it('should send setCleaningPassesOne command', () => {
    let viaLocal = Dorita980Local('myuser', '123456_getprefs', '192.168.1.104');

    let newPreferencesWillbe = {
      flags: 1024,
      lang: 2,
      timezone: 'America/Buenos_Aires',
      name: 'myRobotName',
    };

    let responseOK = {
      ok: null,
      body: generateBody('set', 'prefs', newPreferencesWillbe, 2),
    };

    return expect(viaLocal.setCleaningPassesOne()).resolves.toEqual(responseOK);
  });

  it('should send setCleaningPassesTwo command', () => {
    let viaLocal = Dorita980Local('myuser', '123456_getprefs', '192.168.1.104');

    let newPreferencesWillbe = {
      flags: 1025,
      lang: 2,
      timezone: 'America/Buenos_Aires',
      name: 'myRobotName',
    };

    let responseOK = {
      ok: null,
      body: generateBody('set', 'prefs', newPreferencesWillbe, 2),
    };

    return expect(viaLocal.setCleaningPassesTwo()).resolves.toEqual(responseOK);
  });

  it('should send setAlwaysFinishOn command', () => {
    let viaLocal = Dorita980Local('myuser', '123456_getprefs', '192.168.1.104');

    let newPreferencesWillbe = {
      flags: 1024,
      lang: 2,
      timezone: 'America/Buenos_Aires',
      name: 'myRobotName',
    };

    let responseOK = {
      ok: null,
      body: generateBody('set', 'prefs', newPreferencesWillbe, 2),
    };

    return expect(viaLocal.setAlwaysFinishOn()).resolves.toEqual(responseOK);
  });

  it('should send setAlwaysFinishOff command', () => {
    let viaLocal = Dorita980Local('myuser', '123456_getprefs', '192.168.1.104');

    let newPreferencesWillbe = {
      flags: 1056,
      lang: 2,
      timezone: 'America/Buenos_Aires',
      name: 'myRobotName',
    };

    let responseOK = {
      ok: null,
      body: generateBody('set', 'prefs', newPreferencesWillbe, 2),
    };

    return expect(viaLocal.setAlwaysFinishOff()).resolves.toEqual(responseOK);
  });

  it('should send getBbrun command', () => {
    let viaLocal = Dorita980Local('myuser', 'mypassword', '192.168.1.104');

    let responseOK = {
      ok: null,
      body: generateBody('get', 'bbrun'),
    };

    return expect(viaLocal.getBbrun()).resolves.toEqual(responseOK);
  });

  it('should send getSKU command', () => {
    let viaLocal = Dorita980Local('myuser', 'mypassword', '192.168.1.104');

    let responseOK = {
      ok: null,
      body: generateBody('get', 'sku'),
    };

    return expect(viaLocal.getSKU()).resolves.toEqual(responseOK);
  });

  it('should send getMission command with default decoded arg', () => {
    let viaLocal = Dorita980Local('myuser', '123456_getmission', '192.168.1.104');

    let responseOK = {
      ok: {
        flags: 4,
        missionFlags: {
          beeping: false,
          binFull: false,
          binRemoved: false,
          idle: false,
        },
        notReadyMsg: 'Unknown',
      },
      id: 2,
      body: generateBody('get', 'mssn'),
    };

    return expect(viaLocal.getMission()).resolves.toEqual(responseOK);
  });

  it('should send getMission command with decoded arg in false', () => {
    let viaLocal = Dorita980Local('myuser', '123456_getmission', '192.168.1.104');

    let responseOK = {
      ok: {
        flags: 4,
      },
      id: 2,
      body: generateBody('get', 'mssn'),
    };

    return expect(viaLocal.getMission(false)).resolves.toEqual(responseOK);
  });

  it('should send getMission command with default decoded arg and handle not ok response', () => {
    let viaLocal = Dorita980Local('myuser', '123456_getmission_err', '192.168.1.104');

    let responseOK = {
      error: -12345,
      body: generateBody('get', 'mssn'),
    };

    return expect(viaLocal.getMission()).resolves.toEqual(responseOK);
  });

  it('should send getWirelessConfig command', () => {
    let viaLocal = Dorita980Local('myuser', 'mypassword', '192.168.1.104');

    let responseOK = {
      ok: null,
      body: generateBody('get', 'wlcfg'),
    };

    return expect(viaLocal.getWirelessConfig()).resolves.toEqual(responseOK);
  });

  it('should send getWirelessStatus command', () => {
    let viaLocal = Dorita980Local('myuser', 'mypassword', '192.168.1.104');

    let responseOK = {
      ok: null,
      body: generateBody('get', 'wlstat'),
    };

    return expect(viaLocal.getWirelessStatus()).resolves.toEqual(responseOK);
  });

  it('should send getCloudConfig command', () => {
    let viaLocal = Dorita980Local('myuser', 'mypassword', '192.168.1.104');

    let responseOK = {
      ok: null,
      body: generateBody('get', 'cloudcfg'),
    };

    return expect(viaLocal.getCloudConfig()).resolves.toEqual(responseOK);
  });

  it('should send getWeek command', () => {
    let viaLocal = Dorita980Local('myuser', 'mypassword', '192.168.1.104');

    let responseOK = {
      ok: null,
      body: generateBody('get', 'week'),
    };

    return expect(viaLocal.getWeek()).resolves.toEqual(responseOK);
  });

  it('should send getLangs command', () => {
    let viaLocal = Dorita980Local('myuser', 'mypassword', '192.168.1.104');

    let responseOK = {
      ok: null,
      body: generateBody('get', 'langs'),
    };

    return expect(viaLocal.getLangs()).resolves.toEqual(responseOK);
  });

  it('should send getSys command', () => {
    let viaLocal = Dorita980Local('myuser', 'mypassword', '192.168.1.104');

    let responseOK = {
      ok: null,
      body: generateBody('get', 'sys'),
    };

    return expect(viaLocal.getSys()).resolves.toEqual(responseOK);
  });

  it('should send getWirelessLastStatus command', () => {
    let viaLocal = Dorita980Local('myuser', 'mypassword', '192.168.1.104');

    let responseOK = {
      ok: null,
      body: generateBody('get', 'wllaststat'),
    };

    return expect(viaLocal.getWirelessLastStatus()).resolves.toEqual(responseOK);
  });

  it('should send start command', () => {
    let viaLocal = Dorita980Local('myuser', 'mypassword', '192.168.1.104');

    let responseOK = {
      ok: null,
      body: generateBody('set', 'cmd', { op: 'start' }),
    };

    return expect(viaLocal.start()).resolves.toEqual(responseOK);
  });

  it('should send pause command', () => {
    let viaLocal = Dorita980Local('myuser', 'mypassword', '192.168.1.104');

    let responseOK = {
      ok: null,
      body: generateBody('set', 'cmd', { op: 'pause' }),
    };

    return expect(viaLocal.pause()).resolves.toEqual(responseOK);
  });

  it('should send stop command', () => {
    let viaLocal = Dorita980Local('myuser', 'mypassword', '192.168.1.104');

    let responseOK = {
      ok: null,
      body: generateBody('set', 'cmd', { op: 'stop' }),
    };

    return expect(viaLocal.stop()).resolves.toEqual(responseOK);
  });

  it('should send resume command', () => {
    let viaLocal = Dorita980Local('myuser', 'mypassword', '192.168.1.104');

    let responseOK = {
      ok: null,
      body: generateBody('set', 'cmd', { op: 'resume' }),
    };

    return expect(viaLocal.resume()).resolves.toEqual(responseOK);
  });

  it('should send dock command', () => {
    let viaLocal = Dorita980Local('myuser', 'mypassword', '192.168.1.104');

    let responseOK = {
      ok: null,
      body: generateBody('set', 'cmd', { op: 'dock' }),
    };

    return expect(viaLocal.dock()).resolves.toEqual(responseOK);
  });

  it('should send setWeek command', () => {
    let viaLocal = Dorita980Local('myuser', 'mypassword', '192.168.1.104');

    var newWeek = {
      cycle: ['none', 'start', 'start', 'start', 'start', 'start', 'start'],
      h: [10, 10, 10, 10, 10, 10, 10],
      m: [30, 30, 30, 30, 30, 30, 30],
    };
    let responseOK = {
      ok: null,
      body: generateBody('set', 'week', newWeek),
    };

    return expect(viaLocal.setWeek(newWeek)).resolves.toEqual(responseOK);
  });

  it('should send setTime command', () => {
    let viaLocal = Dorita980Local('myuser', 'mypassword', '192.168.1.104');

    var newTime = { d: 6, h: 13, m: 9 };
    let responseOK = {
      ok: null,
      body: generateBody('set', 'time', newTime),
    };

    return expect(viaLocal.setTime(newTime)).resolves.toEqual(responseOK);
  });

  it('should send setPtime command', () => {
    let viaLocal = Dorita980Local('myuser', 'mypassword', '192.168.1.104');

    var newTime = { time: 1474128577 };
    let responseOK = {
      ok: null,
      body: generateBody('set', 'ptime', newTime),
    };

    return expect(viaLocal.setPtime(newTime)).resolves.toEqual(responseOK);
  });
});
