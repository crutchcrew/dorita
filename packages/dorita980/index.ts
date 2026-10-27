import cloudV1 from './lib/v1/cloud.ts';
import cloudV2 from './lib/v2/cloud.ts';
import localV1 from './lib/v1/local.ts';
import localV2 from './lib/v2/local.ts';
import { discovery, getRobotIP, getRobotPublicInfo } from './lib/discovery.ts';
import type { CloudV1 } from './lib/v1/cloud.ts';
import type { LocalV1 } from './lib/v1/local.ts';
import type { LocalV2, LocalV2Options } from './lib/v2/local.ts';

export type { CloudV1 } from './lib/v1/cloud.ts';
export type { CleaningPreferences, LocalV1, MissionFlags } from './lib/v1/local.ts';
export type {
  LocalV2,
  LocalV2EventMethods,
  LocalV2Events,
  LocalV2Methods,
  LocalV2Options,
} from './lib/v2/local.ts';
export type { Callback, RobotPublicInfo } from './lib/discovery.ts';
export type * from './lib/types.ts';

// Local and Cloud are factories, but the docs (and existing code) call them
// with `new`, so they are typed as both.
interface LocalFactory {
  (blid: string, password: string, ip: string, version: 1): LocalV1;
  (
    blid: string,
    password: string,
    ip: string,
    version?: number,
    options?: number | LocalV2Options,
  ): LocalV2;
  new (blid: string, password: string, ip: string, version: 1): LocalV1;
  new (
    blid: string,
    password: string,
    ip: string,
    version?: number,
    options?: number | LocalV2Options,
  ): LocalV2;
}

interface CloudFactory {
  (blid: string, password: string, version: 1): CloudV1;
  (blid: string, password: string, version?: number): never;
  new (blid: string, password: string, version: 1): CloudV1;
  new (blid: string, password: string, version?: number): never;
}

function local(
  blid: string,
  password: string,
  ip: string,
  version?: number,
  options?: number | LocalV2Options,
): LocalV1 | LocalV2 {
  if (version === 1) return localV1(blid, password, ip);
  return localV2(blid, password, ip, options);
}

function cloud(blid: string, password: string, version?: number): CloudV1 {
  if (version === 1) return cloudV1(blid, password);
  return cloudV2(blid, password);
}

export const Local = local as LocalFactory;
export const Cloud = cloud as CloudFactory;
export { getRobotIP, discovery, getRobotPublicInfo };

export default {
  Local,
  Cloud,
  getRobotIP,
  discovery,
  getRobotPublicInfo,
};
