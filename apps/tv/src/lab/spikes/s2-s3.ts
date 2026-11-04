/**
 * S2 (does storage survive an app update; the webOS quota) and S3 (are the device IDs there and
 * stable across reinstalls) from docs/architecture.md §5. Both compare with what an earlier run
 * left on the TV: the markers read at start (LabContext.previous), before this run writes its own.
 */
import { hash53Base36 } from '@zoma/core';
import { idbWriteTest, markerVerdict, nextMarker, readQuota, writeIdbMarker, writeLocalMarker } from '../storage';
import type { Check, CheckResult, LabContext, LabMarker, Spike } from '../types';

/** S2's pass criterion: at least this much IndexedDB is writable. */
export const WRITE_TARGET_MB = 200;

function marker(context: LabContext): LabMarker {
  return nextMarker(context.previous, { version: context.version, session: context.session, at: new Date().toISOString(), deviceIdHash: context.deviceIdHash });
}

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

const localStorageMarker: Check = {
  id: 'local-storage',
  title: 'A localStorage marker from the last run',
  run: (context) => {
    const verdict = markerVerdict('localStorage', context.previous.localStorage, context.version);
    const error = writeLocalMarker(localStorageOrNull(), marker(context));
    return Promise.resolve<CheckResult>(error === null ? verdict : { status: 'fail', value: verdict.value, note: `writing this run's marker failed: ${error}` });
  },
};

const indexedDbMarker: Check = {
  id: 'indexeddb',
  title: 'An IndexedDB marker from the last run',
  run: async (context) => {
    const verdict = markerVerdict('IndexedDB', context.previous.indexedDB, context.version);
    const error = await writeIdbMarker(window.indexedDB ?? null, marker(context));
    return error === null ? verdict : { status: 'fail', value: verdict.value, note: `writing this run's marker failed: ${error}` };
  },
};

const quota: Check = {
  id: 'quota',
  title: 'The storage quota the engine reports',
  run: async () => {
    const report = await readQuota(navigator as unknown as Parameters<typeof readQuota>[0]);
    return {
      status: 'info',
      value: report,
      note: report.api === 'none' ? 'no quota API' : `${report.quotaMb ?? '?'} MB quota, ${report.usageMb ?? '?'} MB used (${report.api})`,
    };
  },
};

const writeTest: Check = {
  id: 'write-test',
  title: 'How much IndexedDB takes',
  timeoutMs: 15 * 60_000,
  run: async (context) => {
    const factory = window.indexedDB ?? null;
    if (factory === null) return { status: 'fail', note: 'no indexedDB' };
    const report = await idbWriteTest(factory, context.writeMb);
    const reached = report.writtenMb >= context.writeMb;
    return {
      status: reached ? 'pass' : 'fail',
      value: report,
      note: `${report.writtenMb} of ${context.writeMb} MB in ${report.ms} ms${report.error === null ? '' : `, stopped: ${report.error}`}${report.deleted ? '' : '; the scratch database was not deleted'}`,
    };
  },
};

export const S2: Spike = {
  id: 'S2',
  title: 'Storage',
  question: 'Does storage survive an app update (localStorage, IndexedDB)? How much can the app write?',
  checks: [localStorageMarker, indexedDbMarker, quota, writeTest],
};

/** The hash S3 reports and stores: the ID itself never leaves the TV. */
export function deviceIdHash(id: string | null): string | null {
  return id === null ? null : hash53Base36(`zoma-lab-s3|${id}`);
}

/**
 * The ID's format without its value: the lengths of its letter-and-digit groups and their
 * separators (`8-4-4-4-12` for a UUID), and which character classes it uses.
 */
export function idShape(id: string): { readonly length: number; readonly groups: string; readonly classes: string } {
  const groups = id.replace(/[A-Za-z0-9]+/g, (run) => String(run.length));
  const classes = [/[A-Z]/.test(id) ? 'A-Z' : '', /[a-z]/.test(id) ? 'a-z' : '', /[0-9]/.test(id) ? '0-9' : '', /[^A-Za-z0-9]/.test(id) ? 'other' : '']
    .filter((c) => c !== '')
    .join(' ');
  return { length: id.length, groups, classes };
}

/** S3 reads the ID through the adapter itself, so the check sees what the backup will get. */
const deviceId: Check = {
  id: 'device-id',
  title: 'The device ID (DUID / LGUDID)',
  run: async (context) => {
    const id = await context.platform.deviceSecret();
    if (id === null) {
      return context.info.platform === 'browser'
        ? { status: 'skip', note: 'a desktop browser has no device ID' }
        : { status: 'fail', note: `the ${context.info.platform === 'tizen' ? 'DUID' : 'LGUDID'} is not available` };
    }
    return { status: 'pass', value: { hash: deviceIdHash(id), ...idShape(id) }, note: `available (hash ${deviceIdHash(id) ?? ''})` };
  },
};

const stable: Check = {
  id: 'stable',
  title: 'The same ID as the last run',
  run: (context) => {
    const before = context.previous.indexedDB ?? context.previous.localStorage;
    const now = context.deviceIdHash;
    let result: CheckResult;
    if (now === null) result = { status: 'skip', note: 'no device ID to compare' };
    else if (before === null) result = { status: 'info', value: { now }, note: 'no earlier run in this storage (an uninstall wipes it): compare the hash with earlier sessions in artifacts/lab-logs' };
    else if (before.deviceIdHash === null) result = { status: 'info', value: { now, before: null }, note: `the run of ${before.version} (${before.at}) had no device ID` };
    else if (before.deviceIdHash === now) result = { status: 'pass', value: { now, before: before.deviceIdHash }, note: `the same as the run of ${before.version} (${before.at})` };
    else result = { status: 'fail', value: { now, before: before.deviceIdHash }, note: `changed since the run of ${before.version} (${before.at})` };
    return Promise.resolve(result);
  },
};

export const S3: Spike = {
  id: 'S3',
  title: 'Device IDs',
  question: 'Is the device ID (DUID, LGUDID) available, and stable across reinstalls?',
  checks: [deviceId, stable],
};
