/**
 * The sdb commands and the TV's REST answer behind `pnpm tv`, as plain data so they can be tested
 * without a TV (RELAY step 39s6). sdb comes from the Tizen SDK (`<sdk>/tools` on PATH,
 * docs/runbooks/tv-setup.md 3.1).
 */

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
