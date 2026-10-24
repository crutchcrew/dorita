import { EventEmitter } from 'node:events';
import dorita980 from 'dorita980';
import type { Callback, LocalV2, LocalV2Options, MissionUpdate, RobotState } from 'dorita980';
import type { Config } from './config.ts';

const V1_ACTIONS = ['start', 'pause', 'stop', 'resume', 'dock'];
const V2_ACTIONS = [...V1_ACTIONS, 'clean', 'find', 'evac'];
const MISSING_IN_FIRMWARE_2 = ['setTime', 'setPtime'];
const MAX_PATH_POINTS = 10000;

export type Source = 'local' | 'cloud';

export type Connection =
  | 'idle'
  | 'discovering'
  | 'connecting'
  | 'connected'
  | 'ready'
  | 'on-demand'
  | 'offline'
  | 'error'
  | 'stopped';

export interface ConnectionError {
  message: string;
  at: string;
  hint?: string;
}

export interface RobotStatus {
  connection: Connection;
  lastError: ConnectionError | null;
  robotIP: string | null;
  firmwareVersion: 1 | 2;
  keepAlive: boolean;
  live: boolean;
  local: boolean;
  cloud: boolean;
  actions: string[];
}

export interface PathPoint {
  x: number;
  y: number;
  theta: number;
}

// Robot clients are called by method name from the REST routes.
type Client = Record<string, unknown>;

// The parts of the dorita980 module the server uses, injectable for tests.
export interface DoritaModule {
  Local: (
    blid: string,
    password: string,
    ip: string,
    version?: number,
    options?: number | LocalV2Options,
  ) => unknown;
  Cloud: (blid: string, password: string, version?: number) => unknown;
  getRobotIP: (cb: Callback<string>) => void;
}

export interface RobotOptions {
  dorita?: DoritaModule;
  timeoutMs?: number;
}

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new HttpError(504, 'Timed out waiting for the robot.')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function describeError(error: unknown): ConnectionError {
  const message = (error as Error)?.message || String(error);
  const result: ConnectionError = { message, at: new Date().toISOString() };
  // BoringSSL (Bun) lacks the AES128-SHA256 cipher that some robots require.
  if (process.versions.bun && /handshake|cipher|ssl|tls/i.test(message)) {
    result.hint =
      'Your robot may need the AES128-SHA256 TLS cipher, which Bun does not support. Try running the server with Node.js 22.18+: node ./bin/rest980.ts';
  }
  return result;
}

// Owns the connection to the robot, like rest980 did: resolves its IP,
// keeps the local (and cloud) client and relays live state to listeners.
export class Robot extends EventEmitter {
  config: Config;
  dorita: DoritaModule;
  timeoutMs: number;
  ip: string | null;
  local: Client | null = null;
  cloud: Client | null = null;
  state: RobotState | null = null;
  // Poses reported during the current mission, for the web UI map.
  path: PathPoint[] = [];
  pathMission: number | undefined = undefined;
  connection: Connection = 'idle';
  lastError: ConnectionError | null = null;

  constructor(config: Config, options: RobotOptions = {}) {
    super();
    this.config = config;
    this.dorita = options.dorita || dorita980;
    this.timeoutMs = options.timeoutMs || 30000;
    this.ip = config.robotIP || null;
  }

  get firmwareVersion(): 1 | 2 {
    return this.config.firmwareVersion;
  }

  get localEnabled(): boolean {
    return this.config.enableLocal === 'yes';
  }

  get cloudEnabled(): boolean {
    return this.config.enableCloud === 'yes' && this.firmwareVersion !== 2;
  }

  get keepAlive(): boolean {
    return this.config.keepAlive === 'yes';
  }

  // Live state is only pushed by firmware 2.x robots over a kept-alive connection.
  get live(): boolean {
    return this.firmwareVersion === 2 && this.localEnabled && this.keepAlive;
  }

  get actions(): string[] {
    return this.firmwareVersion === 1 ? V1_ACTIONS : V2_ACTIONS;
  }

  start(): void {
    if (this.ip || !this.localEnabled) return this.connect(this.ip);
    this.setConnection('discovering');
    this.dorita.getRobotIP((error, ip) => {
      if (error || !ip) {
        this.lastError = describeError(error);
        return this.setConnection('error');
      }
      this.connect(ip);
    });
  }

  stop(): void {
    const local = this.local as Partial<LocalV2> | null;
    if (local && typeof local.end === 'function') local.end(true);
    this.local = null;
    this.setConnection('stopped');
  }

  private connect(ip: string | null): void {
    const { blid, password } = this.config;
    this.ip = ip;

    if (this.localEnabled && ip) {
      if (this.firmwareVersion === 1) {
        this.local = this.dorita.Local(blid, password, ip, 1) as Client;
        this.setConnection('ready');
      } else if (this.keepAlive) {
        this.local = this.createLocalV2() as unknown as Client;
        this.setConnection('connecting');
      } else {
        this.setConnection('on-demand');
      }
    } else {
      this.setConnection('ready');
    }

    if (this.cloudEnabled) {
      this.cloud = this.dorita.Cloud(blid, password, this.firmwareVersion) as Client;
    }
  }

  private createLocalV2(onError?: (error: Error) => void): LocalV2 {
    const { blid, password, robotPort } = this.config;
    const client = this.dorita.Local(blid, password, this.ip || '', 2, {
      port: robotPort,
      onError:
        onError ||
        ((error) => {
          this.lastError = describeError(error);
          this.setConnection('error');
        }),
    }) as LocalV2;
    if (onError) return client;

    client.on('connect', () => {
      this.lastError = null;
      this.setConnection('connected');
    });
    client.on('reconnect', () => this.setConnection('connecting'));
    client.on('offline', () => this.setConnection('offline'));
    client.on('state' as 'message', (state: RobotState) => {
      this.state = state;
      this.emit('state', state);
    });
    client.on('mission' as 'message', (mission: MissionUpdate) => {
      this.trackPath(mission);
      this.emit('mission', mission);
    });
    return client;
  }

  private trackPath(mission: MissionUpdate): void {
    const status = mission.cleanMissionStatus || {};
    const pose = mission.pose;
    if (status.nMssn !== this.pathMission) {
      this.pathMission = status.nMssn;
      this.path = [];
    }
    if (!pose?.point || status.cycle === 'none') return;
    const last = this.path[this.path.length - 1];
    if (last && last.x === pose.point.x && last.y === pose.point.y) return;
    this.path.push({ x: pose.point.x, y: pose.point.y, theta: pose.theta });
    if (this.path.length > MAX_PATH_POINTS) this.path.shift();
  }

  clearPath(): void {
    this.path = [];
  }

  private setConnection(connection: Connection): void {
    if (this.connection === connection && connection !== 'error') return;
    this.connection = connection;
    this.emit('status', this.status());
  }

  status(): RobotStatus {
    return {
      connection: this.connection,
      lastError: this.lastError,
      robotIP: this.ip,
      firmwareVersion: this.firmwareVersion,
      keepAlive: this.keepAlive,
      live: this.live,
      local: this.localEnabled,
      cloud: this.cloudEnabled,
      actions: this.actions,
    };
  }

  call(source: Source, method: string, args?: unknown): Promise<unknown> {
    if (this.firmwareVersion === 2 && source === 'cloud') {
      return Promise.reject(new HttpError(501, 'Cloud API not implemented yet for firmware 2.x.x'));
    }
    if (this.firmwareVersion === 2 && MISSING_IN_FIRMWARE_2.includes(method)) {
      return Promise.reject(new HttpError(501, 'Method not implemented for firmware 2.x.x'));
    }
    if (source === 'local' && !this.localEnabled) {
      return Promise.reject(new HttpError(503, 'Local API disabled by config.'));
    }
    if (source === 'cloud' && !this.cloudEnabled) {
      return Promise.reject(new HttpError(503, 'Cloud API disabled by config.'));
    }

    if (source === 'local' && this.firmwareVersion === 2 && !this.keepAlive) {
      if (!this.ip) return Promise.reject(new HttpError(503, 'Connection with robot not ready.'));
      return this.sendAndDisconnect(method, args);
    }

    const client = this[source];
    if (!client) return Promise.reject(new HttpError(503, 'Connection with robot not ready.'));
    const fn = client[method];
    if (typeof fn !== 'function') {
      return Promise.reject(
        new HttpError(
          501,
          'Method ' + method + ' not available for firmware ' + this.firmwareVersion + '.x.x',
        ),
      );
    }
    return withTimeout(
      Promise.resolve().then(() => fn.call(client, args)),
      this.timeoutMs,
    );
  }

  // keepAlive=no: connect for a single request and leave the robot free for the
  // official app afterwards.
  private sendAndDisconnect(method: string, args: unknown): Promise<unknown> {
    let client: LocalV2 | undefined;
    const request = new Promise((resolve, reject) => {
      client = this.createLocalV2(reject);
      const fn = (client as unknown as Client)[method];
      if (typeof fn !== 'function') {
        return reject(new HttpError(501, 'Method ' + method + ' not available for firmware 2.x.x'));
      }
      client.on('connect', () => {
        Promise.resolve(fn.call(client, args)).then(resolve, reject);
      });
    });
    return withTimeout(request, this.timeoutMs).then(
      (result) => {
        client?.end();
        return result;
      },
      (error) => {
        client?.end(true);
        throw error;
      },
    );
  }
}
