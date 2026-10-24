import { httpClient } from '../http.ts';

const COMMANDS = [
  'clean',
  'quick',
  'spot',
  'dock',
  'start',
  'pause',
  'resume',
  'stop',
  'wake',
  'reset',
  'find',
  'wipe',
  'patch',
  'dlpkg',
  'rechrg',
  'wlapon',
  'wlapoff',
  'wlston',
  'wlstoff',
  'wifiscan',
  'ipdone',
  'provdone',
  'bye',
  'wllogflush',
  'sleep',
  'off',
  'fbeep',
] as const;

export type CloudV1Command = (typeof COMMANDS)[number];

export type CloudV1 = {
  getStatus: () => Promise<any>;
  accumulatedHistorical: () => Promise<any>;
  missionHistory: () => Promise<any>;
} & Record<CloudV1Command, () => Promise<any>>;

export default function cloudV1(user: string, password: string): CloudV1 {
  if (!user) throw new Error('robotID is required.');
  if (!password) throw new Error('password is required.');

  const headers = {
    'User-Agent': 'aspen%20production/2618 CFNetwork/758.3.15 Darwin/15.4.0',
    Accept: '*/*',
    'Accept-Language': 'en-us',
    'ASSET-ID': 'ElPaso@irobot!' + user,
  };

  function apiCall(command: string, value?: string): Promise<any> {
    let uri = `https://irobot.axeda.com/services/v1/rest/Scripto/execute/AspenApiRequest?blid=${user}&robotpwd=${password}&method=${command}`;
    if (value) {
      uri += '&value=%7B%0A%20%20%22remoteCommand%22%20:%20%22' + value + '%22%0A%7D';
    }

    return httpClient.request({ method: 'GET', uri, headers }).then(JSON.parse);
  }

  const commands = Object.fromEntries(
    COMMANDS.map((command) => [command, () => apiCall('multipleFieldSet', command)]),
  ) as Record<CloudV1Command, () => Promise<any>>;

  return {
    getStatus: () => apiCall('getStatus'),
    accumulatedHistorical: () => apiCall('accumulatedHistorical'),
    missionHistory: () => apiCall('missionHistory'),
    ...commands,
  };
}
