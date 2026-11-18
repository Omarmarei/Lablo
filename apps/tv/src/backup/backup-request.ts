/**
 * What the backup worker is asked for (architecture.md §3.3 B, RELAY step 32b): the TV's device ID
 * (Tizen's DUID, webOS's LGUDID) only after "Allow" at the consent screen; otherwise, and when the
 * platform gives none, `null`, and the worker uses the backup code instead. The platform's own
 * APIs answer only on the main thread, so the ID is read here and passed to the worker; it is never
 * sent anywhere or logged.
 */
import type { LoadedProfile } from '@lablo/data';
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
  return readDeviceSecret(platform).then(request);
}

/**
 * The platform's device ID, or `null` when it gives none, a blank one, or the read fails. Called
 * only by `backupRequest` (after "Allow") and `lookupRequest` (the start with no profile, step 32c2):
 * lookup-request.test.ts scans the app for any other caller.
 */
export function readDeviceSecret(platform: Pick<Platform, 'deviceSecret'>): Promise<string | null> {
  let asked: Promise<string | null>;
  try {
    asked = platform.deviceSecret();
  } catch {
    return Promise.resolve(null);
  }
  return asked.then(
    (secret) => (typeof secret === 'string' && secret.trim() !== '' ? secret : null),
    () => null,
  );
}

/** The profile's device-ID consent (step 32c2's upload reads it at each run): `null` when not asked, or no profile. */
export function consentOf(profile: LoadedProfile | null): boolean | null {
  const answers = profile === null ? undefined : (profile.doc as { onboarding?: { consent?: unknown } }).onboarding;
  const consent = answers === undefined || answers === null ? null : answers.consent;
  return consent === true || consent === false ? consent : null;
}
