import dgram from 'node:dgram';

export interface RobotPublicInfo {
  ver?: string;
  hostname: string;
  robotname?: string;
  ip: string;
  mac?: string;
  sw?: string;
  sku?: string;
  nc?: number;
  proto?: string;
  blid?: string;
  [key: string]: unknown;
}

export type Callback<T> = (error: Error | null, result?: T) => void;

function parseRobotMessage(msg: Buffer): RobotPublicInfo | null {
  try {
    const parsed = JSON.parse(msg.toString()) as RobotPublicInfo;
    const prefix = parsed.hostname?.split('-')[0];
    if (parsed.hostname && parsed.ip && (prefix === 'Roomba' || prefix === 'iRobot')) {
      return parsed;
    }
  } catch {}
  return null;
}

// Broadcasts on the LAN and calls back with the first robot that answers.
export function discovery(cb: Callback<RobotPublicInfo>): void {
  const server = dgram.createSocket('udp4');

  server.on('error', (err) => {
    server.close();
    cb(err);
  });

  server.on('message', (msg) => {
    const robot = parseRobotMessage(msg);
    if (!robot) return;
    server.close();
    console.log('Robot found! with blid/username: ' + robot.hostname.split('-')[1]);
    console.log(robot);
    cb(null, robot);
  });

  server.on('listening', () => {
    console.log('Looking for robots...');
  });

  server.bind(5678, () => {
    const message = Buffer.from('irobotmcs');
    server.setBroadcast(true);
    server.send(message, 0, message.length, 5678, '255.255.255.255');
  });
}

export function getRobotIP(cb: Callback<string>): void {
  discovery((error, robot) => (error ? cb(error) : cb(null, robot?.ip)));
}

export function getRobotPublicInfo(ip: string, cb: Callback<RobotPublicInfo>): void {
  const server = dgram.createSocket('udp4');

  server.on('error', (err) => {
    server.close();
    cb(err);
  });

  server.on('message', (msg) => {
    const robot = parseRobotMessage(msg);
    if (!robot) return;
    server.close();
    robot.blid = robot.hostname.split('-')[1];
    cb(null, robot);
  });

  server.bind(5678, () => {
    const message = Buffer.from('irobotmcs');
    server.send(message, 0, message.length, 5678, ip);
  });
}
