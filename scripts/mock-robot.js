#!/usr/bin/env bun

'use strict';

// A fake firmware 2.x Roomba: an MQTT broker over TLS that accepts dorita980
// commands and publishes simulated robot state. Useful to develop the web UI
// or run the tests without a real robot.
//
//   bun run mock-robot
//   BLID=mockblid PASSWORD=mockpass ROBOT_IP=127.0.0.1 bun start

const tls = require('tls');
const fs = require('fs');
const path = require('path');
const mqttPacket = require('mqtt-packet');

const fixtures = path.join(__dirname, '..', 'test', 'fixtures');

function initialState (blid) {
  return {
    name: 'Mock Roomba',
    sku: 'R980020',
    softwareVer: 'v2.4.16-126',
    batteryType: 'lith',
    batPct: 87,
    bin: { present: true, full: false },
    dock: { known: true },
    pose: { theta: 0, point: { x: 0, y: 0 } },
    signal: { rssi: -48, snr: 38 },
    cap: { pose: 1, ota: 2, multiPass: 2, carpetBoost: 1, pp: 1, binFullDetect: 1, langOta: 1, maps: 1, edge: 1, eco: 1, svcConf: 1 },
    cleanMissionStatus: {
      cycle: 'none',
      phase: 'charge',
      expireM: 0,
      rechrgM: 0,
      error: 0,
      notReady: 0,
      mssnM: 0,
      sqft: 0,
      initiator: 'none',
      nMssn: 42
    },
    cleanSchedule: {
      cycle: ['none', 'start', 'none', 'start', 'none', 'start', 'none'],
      h: [9, 9, 9, 9, 9, 9, 9],
      m: [0, 30, 30, 30, 30, 30, 0]
    },
    carpetBoost: true,
    vacHigh: false,
    openOnly: false,
    noAutoPasses: false,
    twoPass: false,
    binPause: false,
    lastCommand: { command: 'dock', time: Math.floor(Date.now() / 1000), initiator: 'manual' },
    utctime: Math.floor(Date.now() / 1000),
    bbrun: { hr: 211, min: 48, sqft: 566, nStuck: 17, nScrubs: 85, nPicks: 592, nPanics: 178 },
    wifistat: { wifi: 1, uap: false, cloud: 4 },
    netinfo: { dhcp: true, addr: 3232235880, mask: 4294967040, gw: 3232235777, dns1: 3232235777, dns2: 0, bssid: '00:00:00:00:00:00', sec: 4 },
    wlcfg: { sec: 7, ssid: '4d6f636b4e6574' },
    langs: [{ 'en-US': 0 }, { 'fr-FR': 1 }, { 'es-ES': 2 }],
    cloudEnv: 'prod',
    blid
  };
}

function createMockRobot (options) {
  options = options || {};
  const blid = options.blid || 'mockblid';
  const password = options.password || 'mockpass';
  const tickMs = options.tickMs || 1000;
  const log = options.log || function () {};
  const state = initialState(blid);
  const clients = new Set();
  const commands = [];
  let step = 0;
  let timer;

  const server = tls.createServer({
    key: options.key || fs.readFileSync(path.join(fixtures, 'mock-robot-key.pem')),
    cert: options.cert || fs.readFileSync(path.join(fixtures, 'mock-robot-cert.pem'))
  }, onConnection);

  function send (socket, packet) {
    if (!socket.destroyed) socket.write(mqttPacket.generate(packet));
  }

  function report (changes) {
    Object.assign(state, changes);
    const payload = JSON.stringify({ state: { reported: changes } });
    for (const socket of clients) {
      send(socket, { cmd: 'publish', topic: '$aws/things/' + blid + '/shadow/update', payload, qos: 0, retain: false, dup: false });
    }
  }

  function mission (changes) {
    report({ cleanMissionStatus: Object.assign({}, state.cleanMissionStatus, changes) });
  }

  function onCommand (cmd) {
    commands.push(cmd);
    log('command:', cmd.command);
    report({ lastCommand: { command: cmd.command, time: cmd.time, initiator: cmd.initiator } });

    switch (cmd.command) {
      case 'start':
      case 'clean':
      case 'train':
        step = 0;
        mission({ cycle: cmd.command === 'train' ? 'train' : 'clean', phase: 'run', mssnM: 0, sqft: 0, initiator: 'localApp', nMssn: state.cleanMissionStatus.nMssn + 1 });
        break;
      case 'pause':
        mission({ phase: 'stop' });
        break;
      case 'resume':
        mission({ phase: 'run' });
        break;
      case 'stop':
        mission({ cycle: 'none', phase: 'stop' });
        break;
      case 'dock':
        mission({ cycle: 'dock', phase: 'hmUsrDock' });
        break;
      case 'evac':
        mission({ phase: 'evac' });
        setTimeout(() => {
          report({ bin: { present: true, full: false } });
          mission({ phase: 'charge' });
        }, tickMs * 3);
        break;
    }
  }

  // Moves the robot along a lawnmower pattern while cleaning and heads back
  // to the dock (0, 0) when docking.
  function tick () {
    const status = state.cleanMissionStatus;
    const point = state.pose.point;

    if (status.phase === 'run') {
      step++;
      const lane = Math.floor(step / 20);
      const along = step % 20;
      const x = 20 + lane * 30;
      const y = (lane % 2 ? 19 - along : along) * 20 - 200;
      const theta = Math.round(Math.atan2(y - point.y, x - point.x) * 180 / Math.PI);
      report({ pose: { theta, point: { x, y } }, batPct: Math.max(5, state.batPct - (step % 5 === 0 ? 1 : 0)) });
      mission({ mssnM: Math.floor(step / 6), sqft: Math.floor(step / 2) });
      if (step % 90 === 0) report({ bin: { present: true, full: true } });
      if (state.batPct <= 15 || lane > 12) mission({ phase: 'hmPostMsn' });
    } else if (status.phase === 'hmUsrDock' || status.phase === 'hmPostMsn' || status.phase === 'hmMidMsn') {
      const x = Math.trunc(point.x * 0.6);
      const y = Math.trunc(point.y * 0.6);
      report({ pose: { theta: Math.round(Math.atan2(-point.y, -point.x) * 180 / Math.PI), point: { x, y } } });
      if (Math.abs(x) < 5 && Math.abs(y) < 5) {
        report({ pose: { theta: 0, point: { x: 0, y: 0 } } });
        mission({ cycle: 'none', phase: 'charge' });
      }
    } else if (status.phase === 'charge' && state.batPct < 100) {
      report({ batPct: state.batPct + 1 });
    }
    report({ utctime: Math.floor(Date.now() / 1000), signal: { rssi: -45 - Math.floor(Math.random() * 8), snr: 38 } });
  }

  function onConnection (socket) {
    const parser = mqttPacket.parser({ protocolVersion: 4 });
    socket.on('data', (data) => parser.parse(data));
    socket.on('error', () => {});
    socket.on('close', () => clients.delete(socket));

    parser.on('packet', (packet) => {
      switch (packet.cmd) {
        case 'connect': {
          const ok = packet.username === blid && String(packet.password) === password;
          send(socket, { cmd: 'connack', returnCode: ok ? 0 : 5, sessionPresent: false });
          if (!ok) return socket.end();
          clients.add(socket);
          log('client connected');
          // Like the real robot, push the full state in several chunks.
          const keys = Object.keys(state);
          for (let i = 0; i < keys.length; i += 8) {
            const chunk = {};
            for (const key of keys.slice(i, i + 8)) chunk[key] = state[key];
            report(chunk);
          }
          break;
        }
        case 'publish': {
          if (packet.qos === 1) send(socket, { cmd: 'puback', messageId: packet.messageId });
          let msg;
          try { msg = JSON.parse(packet.payload.toString()); } catch (e) { return; }
          if (packet.topic === 'cmd') onCommand(msg);
          if (packet.topic === 'delta' && msg.state) {
            log('delta:', JSON.stringify(msg.state));
            report(msg.state);
          }
          break;
        }
        case 'subscribe':
          send(socket, { cmd: 'suback', messageId: packet.messageId, granted: packet.subscriptions.map(() => 0) });
          break;
        case 'pingreq':
          send(socket, { cmd: 'pingresp' });
          break;
        case 'disconnect':
          socket.end();
          break;
      }
    });
  }

  return {
    state,
    commands,
    listen (port, host) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port || 0, host || '127.0.0.1', () => {
          timer = setInterval(tick, tickMs);
          resolve(server.address().port);
        });
      });
    },
    close () {
      clearInterval(timer);
      for (const socket of clients) socket.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    }
  };
}

module.exports = { createMockRobot };

if (require.main === module) {
  const port = parseInt(process.env.MOCK_ROBOT_PORT || '8883', 10);
  const host = process.env.MOCK_ROBOT_HOST || '127.0.0.1';
  const robot = createMockRobot({
    blid: process.env.BLID,
    password: process.env.PASSWORD,
    log: (...args) => console.log('[mock-robot]', ...args)
  });
  robot.listen(port, host).then((port) => {
    console.log('[mock-robot] listening on ' + host + ':' + port);
    console.log('[mock-robot] start the server with: BLID=' + (process.env.BLID || 'mockblid') + ' PASSWORD=' + (process.env.PASSWORD || 'mockpass') + ' ROBOT_IP=' + host + (port === 8883 ? '' : ' ROBOT_PORT=' + port) + ' FIRMWARE_VERSION=2 bun start');
  });
}
