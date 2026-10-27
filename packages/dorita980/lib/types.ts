// Shapes of the data robots report. Robots add fields over time and models
// differ, so everything is optional and unknown fields are allowed.

export interface Pose {
  theta: number;
  point: { x: number; y: number };
}

export interface CleanMissionStatus {
  cycle?: string;
  phase?: string;
  expireM?: number;
  rechrgM?: number;
  error?: number;
  notReady?: number;
  mssnM?: number;
  sqft?: number;
  initiator?: string;
  nMssn?: number;
  [key: string]: unknown;
}

export interface WeekSchedule {
  cycle: string[];
  h: number[];
  m: number[];
}

export interface RobotState {
  name?: string;
  sku?: string;
  softwareVer?: string;
  batteryType?: string;
  batPct?: number;
  bin?: { present?: boolean; full?: boolean };
  pose?: Pose;
  signal?: { rssi?: number; snr?: number };
  cap?: Record<string, number>;
  cleanMissionStatus?: CleanMissionStatus;
  cleanSchedule?: WeekSchedule;
  carpetBoost?: boolean;
  vacHigh?: boolean;
  openOnly?: boolean;
  noAutoPasses?: boolean;
  twoPass?: boolean;
  binPause?: boolean;
  bbrun?: { hr: number; min: number; [key: string]: number };
  [key: string]: unknown;
}

// A raw state message from a firmware 2.x robot, emitted as 'update'.
export interface RobotUpdate {
  state: { reported: RobotState };
  [key: string]: unknown;
}

// Emitted by the firmware 2.x client every `emitIntervalTime` ms.
export interface MissionUpdate {
  cleanMissionStatus?: CleanMissionStatus;
  pose?: Pose;
  bin?: RobotState['bin'];
}

// Firmware 1.x responses: `{ ok: result, id }` or `{ error, id }`.
export interface UmiResponse<T = any> {
  ok?: T;
  error?: number;
  id?: number;
  [key: string]: unknown;
}

// What every command resolves with on firmware 2.x.
export interface CommandResult {
  ok: null;
}
