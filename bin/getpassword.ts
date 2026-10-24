#!/usr/bin/env bun

import tls from 'node:tls';
import { httpClient } from '../lib/http.ts';
import type { HttpRequestOptions } from '../lib/http.ts';
import { robotTlsOptions } from '../lib/tls.ts';
import { getRobotPublicInfo } from '../lib/discovery.ts';

const host = process.argv[2];
const fversion = process.argv[3];

if (!host) {
  console.log('Usage: bun run getpassword <robot_ip_address> [firmware version]');
  process.exit();
}

const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  Connection: 'close',
  'User-Agent': 'aspen%20production/2618 CFNetwork/758.3.15 Darwin/15.4.0',
  'Content-Encoding': 'identity',
  Accept: '*/*',
  'Accept-Language': 'en-us',
  Host: host,
};

function umiRequest(body: string): HttpRequestOptions {
  return { method: 'POST', uri: 'https://' + host + ':443/umi', strictSSL: false, headers, body };
}

async function checkV1(rid: number): Promise<void> {
  if (rid === 120) {
    console.log(
      'Timeout getting password. Are you following the instructions? You already setup your robot? Its the robot IP correct?',
    );
    process.exit(1);
  }

  let response;
  try {
    response = await httpClient.send(umiRequest('{"do":"get","args":["passwd"],"id":' + rid + '}'));
  } catch (error) {
    console.log(
      'Fatal error connecting to robot. Please verify the IP address and connectivity:',
      error,
    );
    process.exit(1);
  }

  if (response.statusCode === 401) {
    setTimeout(() => checkV1(rid + 1), 2000);
  } else if (response.statusCode === 200) {
    console.log('========>');
    const pass: string = JSON.parse(response.body).ok.passwd;
    console.log('Good job!');
    console.log('Password: ' + pass);
    await getBlid(rid + 1, pass);
  } else {
    console.log('Unespected response. Checking again...');
    setTimeout(() => checkV1(rid + 1), 2000);
  }
}

async function getBlid(rid: number, pass: string): Promise<void> {
  headers.Authorization = 'Basic ' + Buffer.from('user:' + pass).toString('base64');

  let response;
  try {
    response = await httpClient.send(umiRequest('{"do":"get","args":["sys"],"id":' + rid + '}'));
  } catch (error) {
    console.log('Fatal error getting username/blid:', error);
    process.exit(1);
  }

  if (response.statusCode === 200) {
    const blid = (JSON.parse(response.body).ok.blid as number[])
      .map((dec) => (dec + 0x10000).toString(16).slice(-2).toUpperCase())
      .join('');

    console.log('Username/blid: ' + blid);
    console.log('Use this credentials in dorita980 lib :)');
  } else {
    console.log('Unespected error getting username/blid');
  }
}

function checkV2(): void {
  let sliceFrom = 13;
  getRobotPublicInfo(host!, (_error, robotData) => {
    console.log('Robot Data:');
    console.log(robotData);
  });
  const packet = 'f005efcc3b2900';
  const tlsOptions = {
    timeout: 10000,
    ...robotTlsOptions({}, 'AES128-SHA256:TLS_AES_256_GCM_SHA384'),
  };

  const client = tls.connect(8883, host!, tlsOptions, () => {
    client.write(Buffer.from(packet, 'hex'));
  });

  client.on('error', (error) => {
    console.log('Error connecting to robot:', error.message);
    process.exit(1);
  });

  client.on('data', (data: string) => {
    if (data.length === 2) {
      sliceFrom = 9;
      return;
    }
    if (data.length <= 7) {
      console.log('Error getting password. Follow the instructions and try again.');
    } else {
      console.log(
        'Password=> ' +
          Buffer.from(data).subarray(sliceFrom).toString() +
          ' <= Yes, all this string.',
      );
      console.log('Use this credentials in dorita980 lib :)');
    }
    client.end();
    process.exit(0);
  });

  client.setEncoding('utf-8');
}

console.log(
  'Make sure your robot is on the Home Base and powered on (green lights on). Then press and hold the HOME button (or DOCK+SPOT on some models) on your robot until it plays a series of tones (about 2 seconds). Release the button and your robot will flash WIFI light.',
);

if (fversion === '1') {
  console.log('Then wait and look here...');
  void checkV1(1);
} else {
  console.log('Then press any key here...');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', checkV2);
}
