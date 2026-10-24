import { httpClient } from '../http.ts';
import type { UmiResponse } from '../types.ts';

export interface CleaningPreferences {
  carpetBoost: 'auto' | 'eco' | 'performance' | undefined;
  edgeClean: boolean;
  cleaningPasses: 'auto' | '1' | '2' | undefined;
  alwaysFinish: boolean;
}

export interface MissionFlags {
  idle: boolean;
  binFull: boolean;
  binRemoved: boolean;
  beeping: boolean;
}

export interface LocalV1 {
  decodeCleaningPreferences: (flags: number) => CleaningPreferences;
  getTime: () => Promise<UmiResponse>;
  getBbrun: () => Promise<UmiResponse>;
  getLangs: () => Promise<UmiResponse>;
  getSys: () => Promise<UmiResponse>;
  getWirelessLastStatus: () => Promise<UmiResponse>;
  getWeek: () => Promise<UmiResponse>;
  getPreferences: (decode?: boolean) => Promise<UmiResponse>;
  getMission: (decode?: boolean) => Promise<UmiResponse>;
  getWirelessConfig: () => Promise<UmiResponse>;
  getWirelessStatus: () => Promise<UmiResponse>;
  getCloudConfig: () => Promise<UmiResponse>;
  getSKU: () => Promise<UmiResponse>;
  start: () => Promise<UmiResponse>;
  pause: () => Promise<UmiResponse>;
  stop: () => Promise<UmiResponse>;
  resume: () => Promise<UmiResponse>;
  dock: () => Promise<UmiResponse>;
  setWeek: (args: unknown) => Promise<UmiResponse>;
  setTime: (args: unknown) => Promise<UmiResponse>;
  setPtime: (args: unknown) => Promise<UmiResponse>;
  setPreferences: (args: unknown) => Promise<UmiResponse>;
  setCarpetBoostAuto: () => Promise<UmiResponse>;
  setCarpetBoostPerformance: () => Promise<UmiResponse>;
  setCarpetBoostEco: () => Promise<UmiResponse>;
  setEdgeCleanOn: () => Promise<UmiResponse>;
  setEdgeCleanOff: () => Promise<UmiResponse>;
  setCleaningPassesAuto: () => Promise<UmiResponse>;
  setCleaningPassesOne: () => Promise<UmiResponse>;
  setCleaningPassesTwo: () => Promise<UmiResponse>;
  setAlwaysFinishOn: () => Promise<UmiResponse>;
  setAlwaysFinishOff: () => Promise<UmiResponse>;
}

const NOT_READY_MESSAGES: Record<number, string> = {
  0: 'Ready',
  1: 'Near a cliff',
  2: 'Both wheels dropped',
  3: 'Left wheel dropped',
  4: 'Right wheel dropped',
  7: 'Bin missing',
};

function decodeMissionFlags(flags: number): MissionFlags {
  return {
    idle: !(flags & 4),
    binFull: Boolean(flags & 1),
    binRemoved: Boolean(flags & 2),
    beeping: Boolean(flags & 8),
  };
}

function decodeCleaningPreferences(flags: number): CleaningPreferences {
  const carpetBoostOptions: Record<number, CleaningPreferences['carpetBoost']> = {
    0: 'auto',
    16: 'eco',
    80: 'performance',
  };
  const cleaningPasses: Record<number, CleaningPreferences['cleaningPasses']> = {
    0: 'auto',
    1024: '1',
    1025: '2',
  };
  return {
    carpetBoost: carpetBoostOptions[flags & 80],
    edgeClean: !(flags & 2),
    cleaningPasses: cleaningPasses[flags & 1025],
    alwaysFinish: !(flags & 32),
  };
}

export default function localV1(user: string, password: string, host: string): LocalV1 {
  if (!user) throw new Error('robotID is required.');
  if (!password) throw new Error('password is required.');
  if (!host) throw new Error('host is required.');

  let rid = 0;

  const headers = {
    'Content-Type': 'application/json',
    Connection: 'close',
    'User-Agent': 'aspen%20production/2618 CFNetwork/758.3.15 Darwin/15.4.0',
    'Content-Encoding': 'identity',
    Authorization: 'Basic ' + Buffer.from('user:' + password).toString('base64'),
    Accept: '*/*',
    'Accept-Language': 'en-us',
    Host: host,
  };

  function apiCall(method: string, command: string, args?: unknown): Promise<UmiResponse> {
    rid++;
    if (rid > 1000) rid = 1;

    const body =
      '{"do":"' +
      method +
      '","args":["' +
      command +
      '"' +
      (args ? ', ' + JSON.stringify(args) : '') +
      '],"id":' +
      rid +
      '}';

    return httpClient
      .request({
        method: 'POST',
        uri: 'https://' + host + ':443/umi',
        strictSSL: false,
        headers,
        body,
      })
      .then(JSON.parse);
  }

  async function setPreferences(and: number | null, or?: number): Promise<UmiResponse> {
    const resp = await apiCall('get', 'prefs');
    if (and) resp.ok.flags = resp.ok.flags & and;
    if (or) resp.ok.flags = resp.ok.flags | or;
    return apiCall('set', 'prefs', resp.ok);
  }

  async function getPreferences(decode?: boolean): Promise<UmiResponse> {
    const resp = await apiCall('get', 'prefs');
    if (decode !== false && 'ok' in resp) {
      resp.ok.cleaningPreferences = decodeCleaningPreferences(resp.ok.flags);
    }
    return resp;
  }

  async function getMission(decode?: boolean): Promise<UmiResponse> {
    const resp = await apiCall('get', 'mssn');
    if (decode !== false && 'ok' in resp) {
      resp.ok.missionFlags = decodeMissionFlags(resp.ok.flags);
      resp.ok.notReadyMsg = NOT_READY_MESSAGES[resp.ok.notReady] || 'Unknown';
    }
    return resp;
  }

  return {
    decodeCleaningPreferences,
    getTime: () => apiCall('get', 'time'),
    getBbrun: () => apiCall('get', 'bbrun'),
    getLangs: () => apiCall('get', 'langs'),
    getSys: () => apiCall('get', 'sys'),
    getWirelessLastStatus: () => apiCall('get', 'wllaststat'),
    getWeek: () => apiCall('get', 'week'),
    getPreferences,
    getMission,
    getWirelessConfig: () => apiCall('get', 'wlcfg'),
    getWirelessStatus: () => apiCall('get', 'wlstat'),
    getCloudConfig: () => apiCall('get', 'cloudcfg'),
    getSKU: () => apiCall('get', 'sku'),
    start: () => apiCall('set', 'cmd', { op: 'start' }),
    pause: () => apiCall('set', 'cmd', { op: 'pause' }),
    stop: () => apiCall('set', 'cmd', { op: 'stop' }),
    resume: () => apiCall('set', 'cmd', { op: 'resume' }),
    dock: () => apiCall('set', 'cmd', { op: 'dock' }),
    setWeek: (args) => apiCall('set', 'week', args),
    setTime: (args) => apiCall('set', 'time', args),
    setPtime: (args) => apiCall('set', 'ptime', args),
    setPreferences: (args) => apiCall('set', 'prefs', args),
    setCarpetBoostAuto: () => setPreferences(65455),
    setCarpetBoostPerformance: () => setPreferences(null, 80),
    setCarpetBoostEco: () => setPreferences(65471, 16),
    setEdgeCleanOn: () => setPreferences(65533),
    setEdgeCleanOff: () => setPreferences(null, 2),
    setCleaningPassesAuto: () => setPreferences(64510),
    setCleaningPassesOne: () => setPreferences(65534, 1024),
    setCleaningPassesTwo: () => setPreferences(null, 1025),
    setAlwaysFinishOn: () => setPreferences(65503),
    setAlwaysFinishOff: () => setPreferences(null, 32),
  };
}
