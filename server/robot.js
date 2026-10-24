'use strict';

const { EventEmitter } = require('events');

const V1_ACTIONS = ['start', 'pause', 'stop', 'resume', 'dock'];
const V2_ACTIONS = V1_ACTIONS.concat(['clean', 'find', 'evac']);
const MISSING_IN_FIRMWARE_2 = ['setTime', 'setPtime'];
const MAX_PATH_POINTS = 10000;

class HttpError extends Error {
  constructor (status, message) {
    super(message);
    this.status = status;
  }
}

function withTimeout (promise, ms, onTimeout) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      if (onTimeout) onTimeout();
      reject(new HttpError(504, 'Timed out waiting for the robot.'));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function describeError (error) {
  const message = (error && error.message) || String(error);
  const result = { message, at: new Date().toISOString() };
  // BoringSSL (Bun) lacks the AES128-SHA256 cipher that some robots require.
  if (process.versions.bun && /handshake|cipher|ssl|tls/i.test(message)) {
    result.hint = 'Your robot may need the AES128-SHA256 TLS cipher, which Bun does not support. Try running the server with Node.js: node ./bin/rest980.js';
  }
  return result;
}

// Owns the connection to the robot, like rest980 did: resolves its IP,
// keeps the local (and cloud) client and relays live state to listeners.
class Robot extends EventEmitter {
  constructor (config, options) {
    super();
    options = options || {};
    this.config = config;
    this.dorita = options.dorita || require('..');
    this.timeoutMs = options.timeoutMs || 30000;
    this.ip = config.robotIP || null;
    this.local = null;
    this.cloud = null;
    this.state = null;
    // Poses reported during the current mission, for the web UI map.
    this.path = [];
    this.pathMission = null;
    this.connection = 'idle';
    this.lastError = null;
  }

  get firmwareVersion () {
    return this.config.firmwareVersion;
  }

  get localEnabled () {
    return this.config.enableLocal === 'yes';
  }

  get cloudEnabled () {
    return this.config.enableCloud === 'yes' && this.firmwareVersion !== 2;
  }

  get keepAlive () {
    return this.config.keepAlive === 'yes';
  }

  // Live state is only pushed by firmware 2.x robots over a kept-alive connection.
  get live () {
    return this.firmwareVersion === 2 && this.localEnabled && this.keepAlive;
  }

  get actions () {
    return this.firmwareVersion === 1 ? V1_ACTIONS : V2_ACTIONS;
  }

  start () {
    if (this.ip || !this.localEnabled) return this._connect(this.ip);
    this._setConnection('discovering');
    this.dorita.getRobotIP((error, ip) => {
      if (error) {
        this.lastError = describeError(error);
        return this._setConnection('error');
      }
      this._connect(ip);
    });
  }

  stop () {
    if (this.local && typeof this.local.end === 'function') this.local.end(true);
    this.local = null;
    this._setConnection('stopped');
  }

  _connect (ip) {
    const { blid, password } = this.config;
    this.ip = ip;

    if (this.localEnabled) {
      if (this.firmwareVersion === 1) {
        this.local = this.dorita.Local(blid, password, ip, 1);
        this._setConnection('ready');
      } else if (this.keepAlive) {
        this.local = this._createLocalV2();
        this._setConnection('connecting');
      } else {
        this._setConnection('on-demand');
      }
    } else {
      this._setConnection('ready');
    }

    if (this.cloudEnabled) this.cloud = this.dorita.Cloud(blid, password, this.firmwareVersion);
  }

  _createLocalV2 (onError) {
    const { blid, password, robotPort } = this.config;
    const client = this.dorita.Local(blid, password, this.ip, 2, {
      port: robotPort,
      onError: onError || ((error) => {
        this.lastError = describeError(error);
        this._setConnection('error');
      })
    });
    if (onError) return client;

    client.on('connect', () => {
      this.lastError = null;
      this._setConnection('connected');
    });
    client.on('reconnect', () => this._setConnection('connecting'));
    client.on('offline', () => this._setConnection('offline'));
    client.on('state', (state) => {
      this.state = state;
      this.emit('state', state);
    });
    client.on('mission', (mission) => {
      this._trackPath(mission);
      this.emit('mission', mission);
    });
    return client;
  }

  _trackPath (mission) {
    const status = mission.cleanMissionStatus || {};
    const point = mission.pose && mission.pose.point;
    if (status.nMssn !== this.pathMission) {
      this.pathMission = status.nMssn;
      this.path = [];
    }
    if (!point || status.cycle === 'none') return;
    const last = this.path[this.path.length - 1];
    if (last && last.x === point.x && last.y === point.y) return;
    this.path.push({ x: point.x, y: point.y, theta: mission.pose.theta });
    if (this.path.length > MAX_PATH_POINTS) this.path.shift();
  }

  clearPath () {
    this.path = [];
  }

  _setConnection (connection) {
    if (this.connection === connection && connection !== 'error') return;
    this.connection = connection;
    this.emit('status', this.status());
  }

  status () {
    return {
      connection: this.connection,
      lastError: this.lastError,
      robotIP: this.ip,
      firmwareVersion: this.firmwareVersion,
      keepAlive: this.keepAlive,
      live: this.live,
      local: this.localEnabled,
      cloud: this.cloudEnabled,
      actions: this.actions
    };
  }

  call (source, method, args) {
    if (this.firmwareVersion === 2 && source === 'cloud') {
      return Promise.reject(new HttpError(501, 'Cloud API not implemented yet for firmware 2.x.x'));
    }
    if (this.firmwareVersion === 2 && MISSING_IN_FIRMWARE_2.indexOf(method) > -1) {
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
      return this._sendAndDisconnect(method, args);
    }

    const client = this[source];
    if (!client) return Promise.reject(new HttpError(503, 'Connection with robot not ready.'));
    if (typeof client[method] !== 'function') {
      return Promise.reject(new HttpError(501, 'Method ' + method + ' not available for firmware ' + this.firmwareVersion + '.x.x'));
    }
    return withTimeout(Promise.resolve().then(() => client[method](args)), this.timeoutMs);
  }

  // keepAlive=no: connect for a single request and leave the robot free for the
  // official app afterwards.
  _sendAndDisconnect (method, args) {
    let client;
    const request = new Promise((resolve, reject) => {
      client = this._createLocalV2(reject);
      if (typeof client[method] !== 'function') {
        return reject(new HttpError(501, 'Method ' + method + ' not available for firmware 2.x.x'));
      }
      client.on('connect', () => {
        client[method](args).then(resolve, reject);
      });
    });
    return withTimeout(request, this.timeoutMs).then(
      (result) => { client.end(); return result; },
      (error) => { client.end(true); throw error; }
    );
  }
}

module.exports = {
  Robot,
  HttpError,
  describeError
};
