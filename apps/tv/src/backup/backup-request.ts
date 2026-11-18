/**
 * What the backup worker is asked for (architecture.md §3.3 B, RELAY step 32b): the TV's device ID
 * (Tizen's DUID, webOS's LGUDID) only after "Allow" at the consent screen; otherwise, and when the
 * platform gives none, `null`, and the worker uses the backup code instead. The platform's own
 * APIs answer only on the main thread, so the ID is read here and passed to the worker; it is never
 * sent anywhere or logged.
 */
import type { BackupPrepareRequest } from '@lablo/data/client';
import type { Platform } from '@lablo/platform-api';

/** The build's half of the scrypt salt: `__PLATFORM__` and `__APP_ID__`. */
export interface BackupBuild {
  readonly platform: string;
  readonly appId: string;
}

/**
 * The request for `DataEngine.prepareBackup`. `consent` is the profile's answer: `true` reads the
 * device ID; `false` ("Not now") and `null` (not asked yet) never call the platform. An ID that is
 * missing, blank, or can't be read counts as none.
 */
export function backupRequest(platform: Pick<Platform, 'deviceSecret'>, consent: boolean | null, build: BackupBuild): Promise<BackupPrepareRequest> {
  const request = (secret: string | null): BackupPrepareRequest => ({ platform: build.platform, appId: build.appId, secret });
  if (consent !== true) return Promise.resolve(request(null));
  let asked: Promise<string | null>;
  try {
    asked = platform.deviceSecret();
  } catch {
    return Promise.resolve(request(null));
  }
  return asked.then(
    (secret) => request(typeof secret === 'string' && secret.trim() !== '' ? secret : null),
    () => request(null),
  );
}
