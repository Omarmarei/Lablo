/**
 * `pnpm tv` on an LG TV (RELAY step 56): `ares-inspect` (from @webos-tools/cli, as `pnpm device`
 * runs it) forwards the app's inspector to a port on this PC and holds the tunnel while it runs;
 * `eval`, `screen`, `marks` and `soak` then evaluate in the app's page there. It runs without
 * `--open`: the inspector serves one client at a time, and the browser's DevTools would take it.
 * `keys` and `shot` (step 58d) press the app's keys and take the screen through the same port
 * (`Input.dispatchKeyEvent`, `Page.captureScreenshot`): keys reach the page, not the TV's own
 * menus, and the TV's screensaver still comes (they are not remote activity).
 */
import type { ChildProcess } from 'node:child_process';
import type { CdpStep } from './cdp';
import { evaluateOnPort } from './cdp';

/** The PC's port for the inspector when no `--port` is given: the TV's own inspector port, so the number is the same at both ends (as `sdb forward` has it on the Samsung). */
export const WEBOS_PORT = 9998;

/** How long `ares-inspect` may take to launch the app and forward its inspector. */
export const WEBOS_WAIT_MS = 90_000;

/** The `ares-inspect` arguments: the app on `device` (an `ares-setup-device` name), forwarded to `port` here, no browser. */
export function aresInspectArgs(device: string, appId: string, port: number): string[] {
  return ['--device', device, '--app', appId, '--host-port', String(port)];
}

/**
 * The forwarded port in ares-inspect's line `Application Debugging - http://localhost:P...`, or
 * null. A URL on another host is not forwarded to this PC (a device set up without port
 * forwarding): null too.
 */
export function parseAresInspect(output: string): number | null {
  const found = /Application Debugging - https?:\/\/(localhost|127\.0\.0\.1):(\d+)/.exec(output);
  const port = Number(found?.[2] ?? Number.NaN);
  return port >= 1 && port <= 65_535 ? port : null;
}

/** The `id` in a webOS `appinfo.json`, or null. */
export function webosAppId(appinfo: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(appinfo);
  } catch {
    return null;
  }
  const id = (parsed ?? {}) as { id?: unknown };
  return typeof id.id === 'string' && id.id !== '' ? id.id : null;
}

/**
 * What the app's page URL holds on the TV: `.../applications/<id>/index.html`. With the slashes,
 * so the app (`com.lablo.iptv`) is not taken for the lab (`com.lablo.iptv.lab`); the TV's
 * inspector lists every page of its web runtime, its own apps' too.
 */
export function webosPage(appId: string): string {
  return `/${appId}/`;
}

/**
 * Waits for `child` (ares-inspect) to print its forwarded port. It keeps running afterwards: the
 * tunnel lives as long as it does, and this leaves no listener on it. Rejects with what it printed
 * when it ends first or says nothing in `timeoutMs` (and then ends it).
 */
export function waitForAresInspect(child: AresInspect, timeoutMs = WEBOS_WAIT_MS): Promise<number> {
  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    const settle = (done: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onData);
      child.off('exit', onExit);
      child.off('error', onError);
      done();
    };
    const onData = (chunk: Buffer | string): void => {
      output += String(chunk);
      const port = parseAresInspect(output);
      if (port !== null) settle(() => resolve(port));
    };
    const timer = setTimeout(() => {
      settle(() => reject(new Error(`ares-inspect forwarded no port within ${timeoutMs} ms:\n${output.trim()}`)));
      child.kill();
    }, timeoutMs);
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    const onExit = (code: number | null): void => {
      settle(() => reject(new Error(`ares-inspect ended (exit ${String(code)}) before it forwarded a port:\n${output.trim()}`)));
    };
    const onError = (error: Error): void => {
      settle(() => reject(new Error(`ares-inspect failed to start: ${error.message}`)));
    };
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

/** ares-inspect as started (main spawns it with Node; the tests start a stand-in). */
export type AresInspect = Pick<ChildProcess, 'stdout' | 'stderr' | 'once' | 'off' | 'kill'>;

/**
 * `pnpm tv inspect --webos`: starts ares-inspect for `appId` on `device`, waits for its port, and
 * checks the app's page answers there (its `location.href`). Ends ares-inspect when either fails;
 * otherwise it keeps running, holding the tunnel, and the caller waits for it.
 */
export async function forwardInspector(
  start: (args: string[]) => AresInspect,
  device: string,
  appId: string,
  port: number,
  timeoutMs = WEBOS_WAIT_MS,
): Promise<{ readonly child: AresInspect; readonly port: number; readonly href: unknown }> {
  const child = start(aresInspectArgs(device, appId, port));
  try {
    const forwarded = await waitForAresInspect(child, timeoutMs);
    const href = await evaluateOnPort(forwarded, 'location.href', { page: webosPage(appId), timeoutMs: Math.min(timeoutMs, 15_000) });
    return { child, port: forwarded, href };
  } catch (error) {
    child.kill();
    throw error;
  }
}

/** The keys `pnpm tv keys --webos` presses, by name: the codes the LG's remote sends the page (step 58d). */
export const WEBOS_KEY_CODES: { readonly [name: string]: number } = {
  UP: 38,
  DOWN: 40,
  LEFT: 37,
  RIGHT: 39,
  OK: 13,
  BACK: 461,
  CH_UP: 33,
  CH_DOWN: 34,
  RED: 403,
  GREEN: 404,
  YELLOW: 405,
  BLUE: 406,
  INFO: 457,
  PLAY: 415,
  PAUSE: 19,
  STOP: 413,
  DIGIT_0: 48,
  DIGIT_1: 49,
  DIGIT_2: 50,
  DIGIT_3: 51,
  DIGIT_4: 52,
  DIGIT_5: 53,
  DIGIT_6: 54,
  DIGIT_7: 55,
  DIGIT_8: 56,
  DIGIT_9: 57,
};

/** The pause after each key, so the screen has drawn before the next one (leg 168: keys sent too fast went wrong once). */
export const WEBOS_KEY_GAP_MS = 450;

/** A key's press and release on the page, as the remote's. */
function keySteps(code: number): CdpStep[] {
  return [
    { method: 'Input.dispatchKeyEvent', params: { type: 'rawKeyDown', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code } },
    { method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code } },
  ];
}

/**
 * `keys --webos` words as inspector steps: each key name (`WEBOS_KEY_CODES`) pressed and released,
 * then `WEBOS_KEY_GAP_MS`; a number is a further pause in ms. What is wrong, as a sentence.
 */
export function webosKeySteps(words: readonly string[]): CdpStep[] | string {
  const names = Object.keys(WEBOS_KEY_CODES).join(' ');
  if (words.length === 0) return `Usage: pnpm tv keys --webos <key|ms>... (keys: ${names})`;
  const steps: CdpStep[] = [];
  for (const word of words) {
    const code = WEBOS_KEY_CODES[word];
    if (code !== undefined) {
      steps.push(...keySteps(code), { pause: WEBOS_KEY_GAP_MS });
      continue;
    }
    if (!/^\d{1,6}$/.test(word)) return `"${word}" is not a key (${names}) or a pause in ms`;
    steps.push({ pause: Number(word) });
  }
  return steps;
}

/** `shot --webos`: the page as a PNG (1920x1080 on the LG). */
export const SCREENSHOT: CdpStep = { method: 'Page.captureScreenshot', params: { format: 'png' } };

/** The PNG in a `Page.captureScreenshot` answer, or null. */
export function screenshotBytes(result: unknown): Buffer | null {
  const data = (result as { data?: unknown } | null)?.data;
  return typeof data === 'string' && data !== '' ? Buffer.from(data, 'base64') : null;
}
