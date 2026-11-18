/**
 * The look-up's request (RELAY step 32c2, Omar's decision in step 32): at a start with no profile,
 * before onboarding asks anything, the TV reads its device ID with no consent asked, derives the
 * backup's keys in the backup worker and asks the API once whether it has a backup. This is the one
 * read of the ID without "Allow": a backup found means this TV's owner allowed it before a wipe.
 * The ID itself never leaves the TV (the server sees a lookup ID derived from it).
 *
 * Only main.tsx's start with no profile calls this (lookup-request.test.ts scans the app). Every
 * other read goes through `backupRequest`, which reads the ID only after "Allow".
 */
import type { BackupCallRequest } from '@lablo/data/client';
import type { Platform } from '@lablo/platform-api';
import type { BackupBuild } from './backup-request';
import { readDeviceSecret } from './backup-request';

/**
 * The request for `DataEngine.restoreBackup`, with the API's origin `base`; `null` when the platform
 * gives no device ID (the browser, a refused or failed read): there is nothing to look for then,
 * and onboarding starts at once.
 */
export function lookupRequest(platform: Pick<Platform, 'deviceSecret'>, build: BackupBuild, base: string): Promise<BackupCallRequest | null> {
  return readDeviceSecret(platform).then((secret) => (secret === null ? null : { platform: build.platform, appId: build.appId, secret, base }));
}
