/**
 * `pnpm tv` on an LG TV (RELAY step 56): `ares-inspect` (from @webos-tools/cli, as `pnpm device`
 * runs it) forwards the app's inspector to a port on this PC and holds the tunnel while it runs;
 * `eval`, `screen`, `marks` and `soak` then evaluate in the app's page there. It runs without
 * `--open`: the inspector serves one client at a time, and the browser's DevTools would take it.
 * The TV's own remote keys (LG's SSAP API) are not here.
 */
import type { ChildProcess } from 'node:child_process';
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
