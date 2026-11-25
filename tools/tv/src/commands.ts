/**
 * The sdb commands and the TV's REST answer behind `pnpm tv`, as plain data so they can be tested
 * without a TV (RELAY step 39s6). sdb comes from the Tizen SDK (`<sdk>/tools` on PATH,
 * docs/runbooks/tv-setup.md 3.1).
 */

import { parseDebugPort } from './cdp';

/** The TV's own REST API (plain HTTP). */
export const REST_PORT = 8001;

/** `sdb connect`, after the TV's link dropped (the app keeps running). */
export function sdbConnect(serial: string): string[] {
  return ['connect', serial];
}

/** The TV's own launcher: about 0.8 s, where `tizen run` takes about 10 s to return. */
export function sdbLaunch(serial: string, appId: string): string[] {
  return ['-s', serial, 'shell', '0', 'was_execute', appId];
}

/** Relaunches the app with its inspector on; prints `port: N` (`parseDebugPort`). */
export function sdbDebug(serial: string, appId: string): string[] {
  return ['-s', serial, 'shell', '0', 'debug', appId];
}

/** The inspector's port on this PC, the same number as on the TV. */
export function sdbForward(serial: string, port: number): string[] {
  return ['-s', serial, 'forward', `tcp:${port}`, `tcp:${port}`];
}

/** The package id of an app id (`LabloIPTV1.Lablo` is in package `LabloIPTV1`). */
export function packageId(appId: string): string {
  const dot = appId.indexOf('.');
  return dot < 0 ? appId : appId.slice(0, dot);
}

/** Ends the app (`kill` takes the package id; the TV answers "Pkgid: X is Terminated"). */
export function sdbKill(serial: string, appId: string): string[] {
  return ['-s', serial, 'shell', '0', 'kill', packageId(appId)];
}

/** Uninstalls the app: `vd_appuninstall` wants the full app id, the package id alone answers "was get app info failed". */
export function sdbUninstall(serial: string, appId: string): string[] {
  return ['-s', serial, 'shell', '0', 'vd_appuninstall', appId];
}

/** Drops a forward this PC holds (a stale one makes the next `forward` fail with "cannot install forward listener"). */
export function sdbForwardRemove(serial: string, port: number): string[] {
  return ['-s', serial, 'forward', '--remove', `tcp:${port}`];
}

/** What one sdb call gives back (main.ts spawns it; the tests fake it). */
export interface SdbResult {
  readonly status: number;
  readonly output: string;
}
export type SdbRun = (args: string[]) => SdbResult;

/**
 * `pnpm tv inspect`: end the app (a running one makes `debug` hang with no output), relaunch it
 * with the inspector, and forward the port it prints. Stale forwards of this PC (the saved port
 * and the new one) go first, so the forward doesn't fail on a port that is still held.
 */
export function inspectApp(run: SdbRun, serial: string, appId: string, savedPort: number | undefined): { readonly port: number } | { readonly error: string } {
  run(sdbKill(serial, appId));
  const debug = run(sdbDebug(serial, appId));
  const port = parseDebugPort(debug.output);
  if (port === null) return { error: `No inspector port in sdb's answer:\n${debug.output}` };
  if (savedPort !== undefined) run(sdbForwardRemove(serial, savedPort));
  run(sdbForwardRemove(serial, port));
  const forward = run(sdbForward(serial, port));
  if (forward.status !== 0) return { error: `sdb forward failed:\n${forward.output}` };
  return { port };
}

/**
 * The Tizen application id in a `config.xml` (`<tizen:application id="LabloIPTV1.Lablo">`), or
 * null. A copy of tools/device's rule (`tizenManifest`): the tools don't import each other, and
 * test/tv-app-ids.test.ts holds the two together.
 */
export function tizenAppId(configXml: string): string | null {
  return /<tizen:application\s+id="([^"]+)"/.exec(configXml)?.[1] ?? null;
}

/** Where the TV says whether an app runs and shows. */
export function appStateUrl(host: string, appId: string): string {
  return `http://${host}:${REST_PORT}/api/v2/applications/${encodeURIComponent(appId)}`;
}

/** The TV's answer about an app, in words: `running, visible`; the raw answer when it isn't the usual JSON. */
export function describeAppState(status: number, body: string): string {
  if (status !== 200) return `HTTP ${status}: ${body.slice(0, 200)}`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body.slice(0, 200);
  }
  const { running, visible } = (parsed ?? {}) as { running?: unknown; visible?: unknown };
  if (typeof running !== 'boolean') return body.slice(0, 200);
  const shown = typeof visible === 'boolean' ? (visible ? 'visible' : 'hidden') : 'visibility unknown';
  return running ? `running, ${shown}` : 'not running';
}
