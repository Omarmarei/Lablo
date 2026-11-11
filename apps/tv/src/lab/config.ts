/**
 * The lab's settings. The TV build writes them into `lab-config.js` next to index.html
 * (`window.LABLO_LAB_CONFIG`, from `pnpm build:tv --lab-server …`); URL parameters override them
 * where a page has a URL of its own (`pnpm dev`, the e2e tests, the old-engine harness):
 *
 *   lab.html?server=http://127.0.0.1:8080&mb=16&auto=1&soak=60
 */
import type { DeviceInfo } from '@lablo/platform-api';
import { readParam } from '../data/params';
import { SOAK_DEFAULT_MINUTES, SOAK_MAX_MINUTES } from './battery';
import { WRITE_TARGET_MB } from './spikes/s2-s3';

export interface LabBuildConfig {
  readonly server?: string;
  readonly version?: string;
  readonly writeMb?: number;
  readonly autoRun?: boolean;
}

export interface LabConfig {
  /** No trailing slash. */
  readonly server: string;
  readonly version: string;
  readonly writeMb: number;
  /** The player batteries' soak in minutes (a decimal is fine: `soak=0.5`), at most 180. */
  readonly soakMinutes: number;
  /** Run every spike as soon as the lab starts (the TV build's default: launch it and wait). */
  readonly autoRun: boolean;
}

export const DEFAULT_SERVER_PORT = 8080;
const HTTP_URL = /^https?:\/\/[^/?#\s]+$/i;

/** The mock's default address on this page's host (127.0.0.1 on `file://`). */
export function defaultServer(hostname: string): string {
  return `http://${hostname === '' ? '127.0.0.1' : hostname}:${DEFAULT_SERVER_PORT}`;
}

export function readLabConfig(search: string, built: LabBuildConfig | undefined, hostname: string): LabConfig {
  const fromUrl = readParam(search, 'server');
  const server = (fromUrl ?? built?.server ?? defaultServer(hostname)).replace(/\/+$/, '');
  if (!HTTP_URL.test(server)) throw new Error(`the lab server must be http(s)://host[:port], not "${server}"`);
  const mb = readParam(search, 'mb');
  const writeMb = mb !== null && /^\d+$/.test(mb) && Number(mb) > 0 ? Number(mb) : (built?.writeMb ?? WRITE_TARGET_MB);
  const soak = readParam(search, 'soak');
  const soakMinutes = soak !== null && /^\d+(\.\d+)?$/.test(soak) && Number(soak) > 0 ? Math.min(Number(soak), SOAK_MAX_MINUTES) : SOAK_DEFAULT_MINUTES;
  const auto = readParam(search, 'auto');
  return { server, version: built?.version ?? 'dev', writeMb, soakMinutes, autoRun: auto === null ? built?.autoRun === true : auto === '1' };
}

/** `webos-43UK6300PLB-20261104-023012-k3f9`: the collector's file name for this run. */
export function labSession(info: Pick<DeviceInfo, 'platform' | 'model'>, at: Date, random: () => number): string {
  const model = info.model.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 24) || 'unknown';
  const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  let suffix = '';
  for (let i = 0; i < 4; i += 1) suffix += 'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(random() * 36) % 36);
  return `${info.platform}-${model}-${stamp}-${suffix}`;
}
