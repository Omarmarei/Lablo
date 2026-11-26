/**
 * `pnpm tv`: the I/O around the tested pieces (RELAY step 39s6). Each command reads
 * `.tv.local.json`, runs sdb, the remote's socket or the inspector, and prints what it found.
 * With `--webos` (RELAY step 56) the inspector commands go through `ares-inspect`'s port instead.
 * The how-to is docs/runbooks/tv-setup.md 3.7.
 */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { TvArgs } from './args';
import { parseTvArgs } from './args';
import { evaluateOnPort } from './cdp';
import { appStateUrl, describeAppState, inspectApp, sdbConnect, sdbForward, sdbLaunch, sdbUninstall, tizenAppId } from './commands';
import type { TvConfig } from './config';
import { CONFIG_FILE, clientName, formatTvConfig, parseTvConfig, setupConfig, tvSerial } from './config';
import { formatJson } from './format';
import { formatMarks, MARKS_EXPRESSION, SCREEN_EXPRESSION } from './probes';
import { parseScript, REMOTE_PORT, remoteEvent, remotePath, runScript } from './remote';
import type { HeapReading } from './soak';
import { LISTED_STALLS, readDrain, replaySoak, SOAK_DRAIN, SOAK_SAMPLER, StallDetector, summaryLine } from './soak';
import type { AresInspect } from './webos';
import { forwardInspector, WEBOS_PORT, webosAppId, webosPage } from './webos';
import { openRawWebSocket } from './ws';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const CONFIG_PATH = path.join(ROOT, CONFIG_FILE);

class TvError extends Error {}

function readConfig(): TvConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  const config = parseTvConfig(readFileSync(CONFIG_PATH, 'utf8'));
  if (typeof config === 'string') throw new TvError(config);
  return config;
}

function loadConfig(): TvConfig {
  const config = readConfig();
  if (config === null) throw new TvError(`No ${CONFIG_FILE}: run pnpm tv setup <the TV's address> first.`);
  return config;
}

function saveConfig(config: TvConfig): void {
  writeFileSync(CONFIG_PATH, formatTvConfig(config));
}

function sdb(args: readonly string[]): { readonly status: number; readonly output: string } {
  const result = spawnSync('sdb', args, { encoding: 'utf8' });
  if (result.error !== undefined) {
    throw new TvError(`sdb failed to start (${result.error.message}). Put <sdk>/tools on PATH (docs/runbooks/tv-setup.md 3.1).`);
  }
  return { status: result.status ?? 1, output: `${result.stdout}${result.stderr}`.trim() };
}

function appId(lab: boolean): string {
  const file = lab ? path.join(ROOT, 'dist/tv-lab/tizen/config.xml') : path.join(ROOT, 'platforms/tizen/config.xml');
  if (!existsSync(file)) throw new TvError(`${path.relative(ROOT, file)} does not exist. Run pnpm build:tv --platform tizen --target lab first.`);
  const id = tizenAppId(readFileSync(file, 'utf8'));
  if (id === null) throw new TvError(`${path.relative(ROOT, file)} has no tizen:application id`);
  return id;
}

/** The LG app's id (or the lab's), from the manifest `pnpm device` installs. */
function webosApp(lab: boolean): string {
  const file = lab ? path.join(ROOT, 'dist/tv-lab/webos/appinfo.json') : path.join(ROOT, 'platforms/webos/appinfo.json');
  if (!existsSync(file)) throw new TvError(`${path.relative(ROOT, file)} does not exist. Run pnpm build:tv --platform webos --target lab first.`);
  const id = webosAppId(readFileSync(file, 'utf8'));
  if (id === null) throw new TvError(`${path.relative(ROOT, file)} has no "id"`);
  return id;
}

/** Where the inspector commands evaluate: the Samsung's saved (or given) port; on webOS ares-inspect's port and the app's page. */
interface InspectorTarget {
  readonly port: number;
  readonly page?: string;
}

function inspector(args: TvArgs): InspectorTarget {
  if (args.webos) return { port: args.port ?? WEBOS_PORT, page: webosPage(webosApp(args.lab)) };
  if (args.port !== undefined) return { port: args.port };
  const port = loadConfig().cdpPort;
  if (port === undefined) throw new TvError('No inspector port: run pnpm tv inspect first (or pass --port N).');
  return { port };
}

function evaluate(target: InspectorTarget, expression: string, timeoutMs?: number): Promise<unknown> {
  return evaluateOnPort(target.port, expression, { ...(timeoutMs === undefined ? {} : { timeoutMs }), ...(target.page === undefined ? {} : { page: target.page }) });
}

/**
 * `pnpm tv inspect --webos <device>` (RELAY step 56): ares-inspect launches the app if it isn't
 * running and forwards its inspector to a port here, then holds the tunnel; so does this command,
 * until Ctrl+C or ares-inspect ends. It checks the app's page answers before saying so.
 */
async function inspectWebos(args: TvArgs): Promise<void> {
  const [device] = args.words;
  if (device === undefined) throw new TvError('Usage: pnpm tv inspect --webos <ares device> [--lab] [--port N] (the name pnpm device devices webos lists)');
  const appId = webosApp(args.lab);
  const script = createRequire(import.meta.url).resolve('@webos-tools/cli/bin/ares-inspect.js');
  let ended: Promise<number | null> = Promise.resolve(null);
  const start = (aresArgs: string[]): AresInspect => {
    const child = spawn(process.execPath, [script, ...aresArgs], { stdio: ['ignore', 'pipe', 'pipe'] });
    ended = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
    return child;
  };
  let forwarded: Awaited<ReturnType<typeof forwardInspector>>;
  try {
    forwarded = await forwardInspector(start, device, appId, args.port ?? WEBOS_PORT);
  } catch (error) {
    throw new TvError(error instanceof Error ? error.message : String(error));
  }
  const { child, port, href } = forwarded;
  console.log(`the inspector of ${appId} is on port ${port} (${String(href)})`);
  const flags = `--webos${args.lab ? ' --lab' : ''}${port === WEBOS_PORT ? '' : ` --port ${port}`}`;
  console.log(`ares-inspect holds the tunnel while this runs (Ctrl+C ends it). In another terminal: pnpm tv screen ${flags}`);
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
  const code = await ended;
  console.log(`ares-inspect ended (exit ${String(code)}): the tunnel is closed.`);
  process.exitCode = code === 0 ? 0 : 1;
}

function print(value: unknown): void {
  console.log(typeof value === 'string' ? value : formatJson(value));
}

async function keys(args: TvArgs): Promise<void> {
  const steps = parseScript(args.words);
  if (typeof steps === 'string') throw new TvError(steps);
  const config = loadConfig();
  let connect: () => void = () => undefined;
  let refuse: (error: Error) => void = () => undefined;
  const connected = new Promise<void>((resolve, reject) => {
    connect = resolve;
    refuse = reject;
  });
  // Awaited below; this only keeps a refusal that comes with the 101 from counting as unhandled.
  connected.catch(() => undefined);
  const timer = setTimeout(() => refuse(new TvError('The TV sent no ms.channel.connect within 30 s (an "Allow" prompt on the TV?).')), 30_000);
  let finished = false;
  try {
    const ws = await openRawWebSocket({
      host: config.host,
      port: REMOTE_PORT,
      path: remotePath(clientName(config), config.token),
      secure: true,
      onClose: (reason) => {
        if (!finished) refuse(new TvError(`The TV closed the remote channel: ${reason}`));
      },
      onText: (text) => {
        const event = remoteEvent(text);
        if (event.type === 'connect') {
          if (event.token !== null && event.token !== config.token) {
            saveConfig({ ...config, token: event.token });
            console.log(`saved the TV's token in ${CONFIG_FILE}`);
          }
          connect();
        } else if (event.type === 'unauthorized') {
          refuse(new TvError(`The TV refused the remote: allow "${clientName(config)}" on the TV (its prompt shows at the first connection), or remove "token" from ${CONFIG_FILE}.`));
        } else if (event.type === 'ime-start') console.log('the TV keyboard is open');
        else if (event.type === 'ime-end') console.log('the TV keyboard closed');
      },
    });
    try {
      await connected;
      await runScript(ws, steps, (ms) => sleep(ms), (line) => console.log(line));
    } finally {
      finished = true;
      ws.close();
    }
  } finally {
    clearTimeout(timer);
  }
}

async function soak(args: TvArgs): Promise<void> {
  const [sub, file] = args.words;
  if (sub === 'report') {
    if (file === undefined) throw new TvError('Usage: pnpm tv soak report <file.ndjson>');
    const { detector, heap, dropped } = replaySoak(readFileSync(file, 'utf8'));
    print({ ...detector.summary(heap), dropped, list: detector.recent(LISTED_STALLS) });
    return;
  }
  const target = inspector(args);
  const { port } = target;
  if (sub === 'start') {
    print(await evaluate(target, SOAK_SAMPLER));
    return;
  }
  if (sub !== 'watch') throw new TvError('Usage: pnpm tv soak start|watch|report <file>');
  // The Samsung's sdb comes back after a drop; on webOS a failed drain waits for the next one (ares-inspect holds the tunnel).
  const config = args.webos ? null : args.port === undefined ? loadConfig() : readConfig();
  const out = path.join(ROOT, 'artifacts', `tv-soak-${new Date().toISOString().replace(/[:.]/g, '-')}.ndjson`);
  mkdirSync(path.dirname(out), { recursive: true });
  const detector = new StallDetector();
  const heap: HeapReading[] = [];
  const drainOnce = async (): Promise<void> => {
    let value: unknown;
    try {
      value = await evaluate(target, SOAK_DRAIN, 30_000);
    } catch (error) {
      if (config === null) throw error;
      // sdb drops when the TV's link degrades; the app keeps running (soak-loop.sh's fix).
      sdb(sdbConnect(tvSerial(config)));
      sdb(sdbForward(tvSerial(config), port));
      await sleep(3000);
      value = await evaluate(target, SOAK_DRAIN, 30_000);
    }
    if (value === null) {
      console.log(`${clock()} no sampler in the page (first drain, or the page reloaded): ${String(await evaluate(target, SOAK_SAMPLER))}`);
      return;
    }
    const drain = readDrain(value);
    if (drain === null) throw new TvError(`unexpected drain: ${JSON.stringify(value).slice(0, 200)}`);
    appendFileSync(out, `${JSON.stringify(drain)}\n`);
    for (const sample of drain.samples) detector.push(sample);
    heap.push(...drain.heap);
    const lost = drain.dropped > 0 ? `, ${drain.dropped} samples lost (over an hour undrained)` : '';
    console.log(`${clock()} ${summaryLine(detector.summary(heap))}${lost}`);
  };
  console.log(`soak: ${args.minutes} min, a drain every ${args.everySeconds} s, recorded in ${path.relative(ROOT, out)}`);
  const end = Date.now() + args.minutes * 60_000;
  for (;;) {
    try {
      await drainOnce();
    } catch (error) {
      console.log(`${clock()} drain failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const left = end - Date.now();
    if (left <= 0) break;
    await sleep(Math.min(left, args.everySeconds * 1000));
  }
  print({ ...detector.summary(heap), list: detector.recent(LISTED_STALLS) });
  console.log(`recorded in ${path.relative(ROOT, out)} (pnpm tv soak report <file> reads it again)`);
}

function clock(): string {
  return new Date().toTimeString().slice(0, 8);
}

async function run(args: TvArgs): Promise<void> {
  switch (args.command) {
    case 'setup': {
      const [host, serial] = args.words;
      if (host === undefined) throw new TvError('Usage: pnpm tv setup <the TV address> [sdb serial]');
      const config = setupConfig(readConfig(), host, serial);
      saveConfig(config);
      console.log(`wrote ${CONFIG_FILE} (gitignored): sdb serial ${tvSerial(config)}. Next: pnpm tv keys (allow the PC on the TV the first time).`);
      return;
    }
    case 'keys':
      await keys(args);
      return;
    case 'launch': {
      const config = loadConfig();
      const started = performance.now();
      const result = sdb(sdbLaunch(tvSerial(config), appId(args.lab)));
      console.log(`${result.output}\n(${Math.round(performance.now() - started)} ms)`);
      process.exitCode = result.status;
      return;
    }
    case 'inspect': {
      if (args.webos) {
        await inspectWebos(args);
        return;
      }
      const config = loadConfig();
      const result = inspectApp(sdb, tvSerial(config), appId(args.lab), config.cdpPort);
      if ('error' in result) throw new TvError(result.error);
      saveConfig({ ...config, cdpPort: result.port });
      console.log(`the inspector is on port ${result.port}, forwarded and saved in ${CONFIG_FILE}. Next: pnpm tv screen`);
      return;
    }
    case 'uninstall': {
      const config = loadConfig();
      const result = sdb(sdbUninstall(tvSerial(config), appId(args.lab)));
      console.log(result.output);
      process.exitCode = result.status;
      return;
    }
    case 'reconnect': {
      const config = loadConfig();
      console.log(sdb(sdbConnect(tvSerial(config))).output);
      if (config.cdpPort !== undefined) console.log(sdb(sdbForward(tvSerial(config), config.cdpPort)).output);
      return;
    }
    case 'state': {
      const config = loadConfig();
      const response = await fetch(appStateUrl(config.host, appId(args.lab)), { signal: AbortSignal.timeout(5000) });
      console.log(describeAppState(response.status, await response.text()));
      return;
    }
    case 'eval': {
      const [expression] = args.words;
      if (expression === undefined) throw new TvError('Usage: pnpm tv eval <expression|@file.js> [--port N]');
      print(await evaluate(inspector(args), expression.startsWith('@') ? readFileSync(expression.slice(1), 'utf8') : expression));
      return;
    }
    case 'screen': {
      const screen = (await evaluate(inspector(args), SCREEN_EXPRESSION)) as { focus: string | null; text: string };
      console.log(`focus: ${screen.focus ?? '(none)'}\n${screen.text}`);
      return;
    }
    case 'marks':
      console.log(formatMarks(await evaluate(inspector(args), MARKS_EXPRESSION)));
      return;
    case 'soak':
      await soak(args);
      return;
  }
}

export async function main(argv: readonly string[]): Promise<void> {
  const args = parseTvArgs(argv);
  if (typeof args === 'string') {
    console.error(args);
    process.exitCode = 1;
    return;
  }
  try {
    await run(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
