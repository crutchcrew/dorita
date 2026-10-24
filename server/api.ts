import type { Source } from './robot.ts';

export interface Route {
  methods: string[];
  path: string;
  source: Source;
  method: string;
  hasArgs: boolean;
  onlyFirmware?: 1 | 2;
}

type RouteSpec = [string | string[], string, Source, string, boolean?, (1 | 2)?];

const ACTION = ['GET', 'POST'];

// REST routes carried over from rest980, mapped to dorita980 methods:
// [HTTP method(s), path under /api, source, dorita980 method, takes a body, only for firmware]
const specs: RouteSpec[] = [
  // Local actions. rest980 used GET; POST is accepted too.
  [ACTION, '/local/action/start', 'local', 'start'],
  [ACTION, '/local/action/stop', 'local', 'stop'],
  [ACTION, '/local/action/pause', 'local', 'pause'],
  [ACTION, '/local/action/dock', 'local', 'dock'],
  [ACTION, '/local/action/resume', 'local', 'resume'],
  [ACTION, '/local/action/clean', 'local', 'clean'],
  [ACTION, '/local/action/find', 'local', 'find'],
  [ACTION, '/local/action/evac', 'local', 'evac'],
  ['POST', '/local/action/cleanRoom', 'local', 'cleanRoom', true],

  // Local configuration.
  ['GET', '/local/config/time', 'local', 'getTime'],
  ['POST', '/local/config/time', 'local', 'setTime', true],
  ['POST', '/local/config/ptime', 'local', 'setPtime', true],
  ['GET', '/local/config/langs', 'local', 'getLangs'],
  ['GET', '/local/config/bbrun', 'local', 'getBbrun'],
  ['GET', '/local/config/cloud', 'local', 'getCloudConfig'],
  ['GET', '/local/config/week', 'local', 'getWeek'],
  ['POST', '/local/config/week', 'local', 'setWeek', true],
  ['POST', '/local/config/carpetBoost/auto', 'local', 'setCarpetBoostAuto'],
  ['POST', '/local/config/carpetBoost/performance', 'local', 'setCarpetBoostPerformance'],
  ['POST', '/local/config/carpetBoost/eco', 'local', 'setCarpetBoostEco'],
  ['POST', '/local/config/edgeClean/on', 'local', 'setEdgeCleanOn'],
  ['POST', '/local/config/edgeClean/off', 'local', 'setEdgeCleanOff'],
  ['POST', '/local/config/cleaningPasses/auto', 'local', 'setCleaningPassesAuto'],
  ['POST', '/local/config/cleaningPasses/one', 'local', 'setCleaningPassesOne'],
  ['POST', '/local/config/cleaningPasses/two', 'local', 'setCleaningPassesTwo'],
  ['POST', '/local/config/alwaysFinish/on', 'local', 'setAlwaysFinishOn'],
  ['POST', '/local/config/alwaysFinish/off', 'local', 'setAlwaysFinishOff'],
  ['POST', '/local/config/preferences', 'local', 'setPreferences', true],
  ['GET', '/local/config/preferences', 'local', 'getPreferences'],

  // Local info.
  ['GET', '/local/info/sku', 'local', 'getSKU'],
  ['GET', '/local/info/wireless', 'local', 'getWirelessStatus'],
  ['GET', '/local/info/lastwireless', 'local', 'getWirelessLastStatus'],
  ['GET', '/local/info/mission', 'local', 'getMission'],
  ['GET', '/local/info/sys', 'local', 'getSys'],
  ['GET', '/local/info/state', 'local', 'getRobotState', false, 2],

  // Cloud (firmware 1.x only).
  ['GET', '/cloud/info/status', 'cloud', 'getStatus'],
  ['GET', '/cloud/info/history', 'cloud', 'accumulatedHistorical'],
  ['GET', '/cloud/info/missionHistory', 'cloud', 'missionHistory'],
  ['GET', '/cloud/action/clean', 'cloud', 'clean'],
  ['GET', '/cloud/action/quick', 'cloud', 'quick'],
  ['GET', '/cloud/action/spot', 'cloud', 'spot'],
  ['GET', '/cloud/action/dock', 'cloud', 'dock'],
  ['GET', '/cloud/action/start', 'cloud', 'start'],
  ['GET', '/cloud/action/stop', 'cloud', 'stop'],
  ['GET', '/cloud/action/pause', 'cloud', 'pause'],
  ['GET', '/cloud/action/resume', 'cloud', 'resume'],
  ['GET', '/cloud/action/wake', 'cloud', 'wake'],
  ['GET', '/cloud/action/reset', 'cloud', 'reset'],
  ['GET', '/cloud/action/find', 'cloud', 'find'],
  ['GET', '/cloud/action/wipe', 'cloud', 'wipe'],
  ['GET', '/cloud/action/sleep', 'cloud', 'sleep'],
  ['GET', '/cloud/action/off', 'cloud', 'off'],
  ['GET', '/cloud/action/fbeep', 'cloud', 'fbeep'],
];

export const routes: Route[] = specs.map(
  ([methods, path, source, method, hasArgs, onlyFirmware]) => ({
    methods: ([] as string[]).concat(methods),
    path: '/api' + path,
    source,
    method,
    hasArgs: Boolean(hasArgs),
    onlyFirmware,
  }),
);
