import type { EventEmitter } from 'node:events';
import mqtt from 'mqtt';
import type { IClientOptions, MqttClient } from 'mqtt';
import { robotTlsOptions } from '../tls.ts';
import type { RobotTlsCustomOptions } from '../tls.ts';
import type {
  CommandResult,
  MissionUpdate,
  RobotState,
  RobotUpdate,
  WeekSchedule,
} from '../types.ts';

export interface LocalV2Options extends RobotTlsCustomOptions {
  // How often the 'mission' event is emitted, in ms. Default 800.
  emitIntervalTime?: number;
  // Robot MQTT port. Default 8883.
  port?: number;
  // Called on connection errors, which are otherwise ignored so they don't
  // crash the host process.
  onError?: (error: Error) => void;
}

export interface LocalV2Methods {
  getTime: () => Promise<number>;
  getBbrun: () => Promise<RobotState['bbrun']>;
  getLangs: () => Promise<unknown>;
  getSys: () => Promise<RobotState>;
  getWirelessLastStatus: () => Promise<RobotState>;
  getWeek: () => Promise<WeekSchedule>;
  getPreferences: (decode?: boolean) => Promise<RobotState>;
  getRobotState: (fields?: string | string[]) => Promise<RobotState>;
  getMission: (decode?: boolean) => Promise<RobotState>;
  getBasicMission: (decode?: boolean) => Promise<RobotState>;
  getWirelessConfig: () => Promise<RobotState>;
  getWirelessStatus: () => Promise<RobotState>;
  getCloudConfig: () => Promise<string>;
  getSKU: () => Promise<string>;
  start: () => Promise<CommandResult>;
  clean: () => Promise<CommandResult>;
  cleanRoom: (args: Record<string, unknown>) => Promise<CommandResult>;
  pause: () => Promise<CommandResult>;
  stop: () => Promise<CommandResult>;
  resume: () => Promise<CommandResult>;
  dock: () => Promise<CommandResult>;
  find: () => Promise<CommandResult>;
  evac: () => Promise<CommandResult>;
  train: () => Promise<CommandResult>;
  setWeek: (args: WeekSchedule) => Promise<CommandResult>;
  setPreferences: (args: Partial<RobotState>) => Promise<CommandResult>;
  setCarpetBoostAuto: () => Promise<CommandResult>;
  setCarpetBoostPerformance: () => Promise<CommandResult>;
  setCarpetBoostEco: () => Promise<CommandResult>;
  setEdgeCleanOn: () => Promise<CommandResult>;
  setEdgeCleanOff: () => Promise<CommandResult>;
  setCleaningPassesAuto: () => Promise<CommandResult>;
  setCleaningPassesOne: () => Promise<CommandResult>;
  setCleaningPassesTwo: () => Promise<CommandResult>;
  setAlwaysFinishOn: () => Promise<CommandResult>;
  setAlwaysFinishOff: () => Promise<CommandResult>;
}

// The events the client emits on top of the MQTT ones.
export interface LocalV2Events {
  update: (message: RobotUpdate) => void;
  state: (state: RobotState) => void;
  mission: (mission: MissionUpdate) => void;
}

export interface LocalV2EventMethods {
  on<E extends keyof LocalV2Events>(event: E, listener: LocalV2Events[E]): LocalV2;
  once<E extends keyof LocalV2Events>(event: E, listener: LocalV2Events[E]): LocalV2;
  off<E extends keyof LocalV2Events>(event: E, listener: LocalV2Events[E]): LocalV2;
  removeListener<E extends keyof LocalV2Events>(event: E, listener: LocalV2Events[E]): LocalV2;
}

// The MQTT client with the robot methods mixed in. Besides the MQTT events it
// emits 'update' (raw message), 'state' (full state) and 'mission'.
export type LocalV2 = MqttClient & LocalV2Methods & LocalV2EventMethods;

const POSSIBLE_CAPABILITIES = [
  'pose',
  'ota',
  'multiPass',
  'carpetBoost',
  'pp',
  'binFullDetect',
  'langOta',
  'maps',
  'edge',
  'eco',
  'svcConf',
];

export default function localV2(
  user: string,
  password: string,
  host: string,
  emitIntervalTime?: number | LocalV2Options,
): LocalV2 {
  if (!user) throw new Error('robotID is required.');
  if (!password) throw new Error('password is required.');
  if (!host) throw new Error('host is required.');

  let customOptions: LocalV2Options = {};
  if (emitIntervalTime && typeof emitIntervalTime === 'object') {
    customOptions = emitIntervalTime;
    emitIntervalTime = customOptions.emitIntervalTime;
  }
  const interval = (emitIntervalTime as number | undefined) || 800;

  let robotState: RobotState = {};
  let cap: Record<string, number> | null = null;
  let missionInterval: ReturnType<typeof setInterval> | undefined;

  const client = mqtt.connect('tls://' + host, {
    port: customOptions.port || 8883,
    clientId: user,
    protocolId: 'MQTT',
    protocolVersion: 4,
    clean: false,
    username: user,
    password,
    ...robotTlsOptions(customOptions),
  } as IClientOptions);

  // MqttClient only types its own events, so emit ours through the base class.
  const emit = <E extends keyof LocalV2Events>(
    event: E,
    ...args: Parameters<LocalV2Events[E]>
  ): boolean => (client as unknown as EventEmitter).emit(event, ...args);

  client.on('error', (e: Error) => {
    if (customOptions.onError) customOptions.onError(e);
    // Ignored by default to avoid crashing the host process.
  });

  client.on('connect', () => {
    missionInterval = setInterval(() => {
      if (robotState.cleanMissionStatus) {
        emit('mission', filterProps(['cleanMissionStatus', 'pose', 'bin']) as MissionUpdate);
      }
    }, interval);
  });

  client.on('close', () => {
    clearInterval(missionInterval);
  });

  client.on('packetreceive', (packet) => {
    if (packet.cmd !== 'publish' || !packet.payload) return;
    try {
      const msg = JSON.parse(packet.payload.toString()) as RobotUpdate;
      robotState = Object.assign(robotState, msg.state.reported);
      emit('update', msg);
      emit('state', robotState);
      if (robotState.cap) cap = { ...robotState.cap };
    } catch {}
  });

  function apiCall(
    topic: 'cmd' | 'delta',
    command: unknown,
    additionalArgs?: object,
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      let cmd: object = { command, time: (Date.now() / 1000) | 0, initiator: 'localApp' };
      if (topic === 'delta') cmd = { state: command };
      if (additionalArgs) cmd = Object.assign(cmd, additionalArgs);
      client.publish(topic, JSON.stringify(cmd), (e?: Error) => {
        if (e) return reject(e);
        resolve({ ok: null }); // for retro compatibility
      });
    });
  }

  function hasAllProps(obj: RobotState, properties: string[]): boolean {
    for (const prop of properties) {
      if (POSSIBLE_CAPABILITIES.includes(prop) && cap && !(prop in cap)) {
        obj[prop] = undefined; // asking for a non available capability, just set to undefined
      }
      if (!Object.prototype.hasOwnProperty.call(obj, prop)) return false;
    }
    return true;
  }

  function filterProps(properties: string[]): unknown {
    if (properties.length === 1) return robotState[properties[0]!];
    const ret: RobotState = {};
    for (const prop of properties) ret[prop] = robotState[prop];
    return ret;
  }

  function waitPreferences(
    waitFor: string | string[] | undefined,
    returnOnlyThat: boolean,
  ): Promise<any> {
    const fields = typeof waitFor === 'string' ? [waitFor] : waitFor || [];
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (hasAllProps(robotState, fields)) {
          clearInterval(checkInterval);
          resolve(returnOnlyThat ? filterProps(fields) : robotState);
        }
      }, 100);
    });
  }

  const methods: LocalV2Methods = {
    getTime: () => waitPreferences(['utctime'], true),
    getBbrun: () => waitPreferences(['bbrun'], true),
    getLangs: () => waitPreferences(['langs'], true),
    getSys: () =>
      waitPreferences(
        [
          'bbrstinfo',
          'cap',
          'sku',
          'batteryType',
          'soundVer',
          'uiSwVer',
          'navSwVer',
          'wifiSwVer',
          'mobilityVer',
          'bootloaderVer',
          'umiVer',
          'softwareVer',
          'audio',
          'bin',
        ],
        true,
      ),
    getWirelessLastStatus: () => waitPreferences(['wifistat', 'wlcfg'], true),
    getWeek: () => waitPreferences(['cleanSchedule'], true),
    getPreferences: () =>
      waitPreferences(['cleanMissionStatus', 'cleanSchedule', 'name', 'vacHigh', 'signal'], false),
    getRobotState: (fields) => waitPreferences(fields, false),
    getMission: () => waitPreferences(['cleanMissionStatus', 'bin', 'batPct'], true),
    getBasicMission: () => waitPreferences(['cleanMissionStatus', 'bin', 'batPct'], true),
    getWirelessConfig: () => waitPreferences(['wlcfg', 'netinfo'], true),
    getWirelessStatus: () => waitPreferences(['wifistat', 'netinfo'], true),
    getCloudConfig: () => waitPreferences(['cloudEnv'], true),
    getSKU: () => waitPreferences(['sku'], true),
    start: () => apiCall('cmd', 'start'),
    clean: () => apiCall('cmd', 'clean'),
    cleanRoom: (args) => apiCall('cmd', 'start', args),
    pause: () => apiCall('cmd', 'pause'),
    stop: () => apiCall('cmd', 'stop'),
    resume: () => apiCall('cmd', 'resume'),
    dock: () => apiCall('cmd', 'dock'),
    find: () => apiCall('cmd', 'find'),
    evac: () => apiCall('cmd', 'evac'),
    train: () => apiCall('cmd', 'train'),
    setWeek: (args) => apiCall('delta', { cleanSchedule: args }),
    setPreferences: (args) => apiCall('delta', args),
    setCarpetBoostAuto: () => apiCall('delta', { carpetBoost: true, vacHigh: false }),
    setCarpetBoostPerformance: () => apiCall('delta', { carpetBoost: false, vacHigh: true }),
    setCarpetBoostEco: () => apiCall('delta', { carpetBoost: false, vacHigh: false }),
    setEdgeCleanOn: () => apiCall('delta', { openOnly: false }),
    setEdgeCleanOff: () => apiCall('delta', { openOnly: true }),
    setCleaningPassesAuto: () => apiCall('delta', { noAutoPasses: false, twoPass: false }),
    setCleaningPassesOne: () => apiCall('delta', { noAutoPasses: true, twoPass: false }),
    setCleaningPassesTwo: () => apiCall('delta', { noAutoPasses: true, twoPass: true }),
    setAlwaysFinishOn: () => apiCall('delta', { binPause: false }),
    setAlwaysFinishOff: () => apiCall('delta', { binPause: true }),
  };

  // The client emits the LocalV2Events through `emit` above.
  return Object.assign(client, methods) as unknown as LocalV2;
}
