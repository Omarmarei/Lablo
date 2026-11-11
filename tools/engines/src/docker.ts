import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface DockerResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export function docker(args: readonly string[], options: { inherit?: boolean } = {}): DockerResult {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    stdio: options.inherit === true ? 'inherit' : 'pipe',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw new Error(`could not run docker (${result.error.message}); the old-engine harness needs Docker`);
  }
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function dockerOk(args: readonly string[]): string {
  const result = docker(args);
  if (result.status !== 0) throw new Error(`docker ${args[0] ?? ''} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  return result.stdout.trim();
}

export function assertDockerRunning(): void {
  const result = docker(['version', '--format', '{{.Server.Version}}']);
  if (result.status !== 0) {
    throw new Error(`the Docker daemon is not reachable (start Docker Desktop on Windows):\n${result.stderr.trim()}`);
  }
}

/** Everything the image is built from: editing any of them gives a new tag, so a rebuild. */
export const IMAGE_FILES = ['Dockerfile', 'run-chrome.sh', 'serve-fixture.sh'] as const;

/** The image tag is a hash of the build context, so editing the Dockerfile rebuilds it. */
export function imageTag(dockerDir: string): string {
  const hash = createHash('sha256');
  for (const name of IMAGE_FILES) {
    hash.update(name);
    // Line endings are normalised so a CRLF checkout produces the same tag as CI.
    hash.update(readFileSync(path.join(dockerDir, name), 'utf8').replace(/\r\n/g, '\n'));
  }
  return `lablo-old-engines:${hash.digest('hex').slice(0, 12)}`;
}

export function ensureImage(dockerDir: string, log: (line: string) => void): string {
  const tag = imageTag(dockerDir);
  if (docker(['image', 'inspect', tag]).status === 0) return tag;
  log(`building Docker image ${tag}`);
  const build = docker(['build', '-t', tag, dockerDir], { inherit: true });
  if (build.status !== 0) throw new Error(`docker build of ${tag} failed`);
  return tag;
}

/**
 * The hour of the day each engine starts in, in its own zone (RELAY step 26q): 21:00 to 21:59.
 * The guide then opens on a view that ends before midnight, and the walk's three programmes on
 * (from the one after now) cross it, on every run, whatever the time of day. The walk once passed
 * or failed by the hour CI happened to run at (a guide that read only the days in view failed
 * from 21:00 to 22:29 and from 00:00 to 01:59).
 */
export const ENGINE_HOUR = 21;

/**
 * A zone for each whole-hour offset from UTC, −11 to +12 hours (the key, in hours ahead of UTC):
 * none has daylight saving time or has changed its offset for years, and no name has a digit.
 * Chromium 68's V8 takes the zone from ICU, and ICU ignores a `TZ` with a digit in it
 * (`isValidOlsonID`): `Etc/GMT+1` left 68 in UTC on CI, while 53 and 56 (the C library's local
 * time) took it. docker.test.ts checks each offset with Node's own zone data.
 */
export const FIXED_ZONES: Readonly<Record<number, string>> = {
  [-11]: 'Pacific/Pago_Pago',
  [-10]: 'Pacific/Honolulu',
  [-9]: 'Pacific/Gambier',
  [-8]: 'Pacific/Pitcairn',
  [-7]: 'America/Phoenix',
  [-6]: 'America/Regina',
  [-5]: 'America/Panama',
  [-4]: 'America/Puerto_Rico',
  [-3]: 'America/Cayenne',
  [-2]: 'Atlantic/South_Georgia',
  [-1]: 'Atlantic/Cape_Verde',
  0: 'Etc/UTC',
  1: 'Africa/Lagos',
  2: 'Africa/Johannesburg',
  3: 'Africa/Nairobi',
  4: 'Asia/Dubai',
  5: 'Asia/Tashkent',
  6: 'Asia/Thimphu',
  7: 'Asia/Bangkok',
  8: 'Asia/Shanghai',
  9: 'Asia/Tokyo',
  10: 'Australia/Brisbane',
  11: 'Pacific/Guadalcanal',
  12: 'Pacific/Tarawa',
};

/**
 * The engine's zone, where `nowMs` falls in hour `hour` (0–23): one of `FIXED_ZONES`, −11 to +12
 * hours from UTC. The container's `TZ`: old Chromium has no CDP zone override, and its V8 (the
 * C library's local time on 53 and 56, ICU on 68) reads `TZ` (the image has tzdata).
 */
export function engineZone(nowMs: number, hour: number = ENGINE_HOUR): string {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error(`the engine's hour must be 0 to 23, not ${hour}`);
  let offset = (hour - new Date(nowMs).getUTCHours() + 24) % 24;
  if (offset > 12) offset -= 24;
  return FIXED_ZONES[offset]!;
}

/** A `FIXED_ZONES` zone's offset from UTC in minutes, as `Date.prototype.getTimezoneOffset` gives it (UTC minus local). */
export function zoneOffset(zone: string): number {
  for (const key of Object.keys(FIXED_ZONES)) {
    if (FIXED_ZONES[Number(key)] === zone) return 0 - Number(key) * 60;
  }
  throw new Error(`not one of the engines' fixed zones: ${zone}`);
}

export interface RunningEngine {
  readonly container: string;
  /** Host port forwarded to the container's DevTools port. */
  readonly port: number;
}

/**
 * Starts one engine: the snapshot zip and the app directory are bind-mounted read-only, and
 * DevTools is published on a random loopback port.
 */
export function startEngine(options: {
  image: string;
  zip: string;
  appDir: string;
  name: string;
  /** Extra Chromium switches, appended by run-chrome.sh. */
  chromeFlags?: readonly string[];
  /** The engine's time zone (`engineZone`), as `TZ`; without it the container's UTC. */
  zone?: string;
}): RunningEngine {
  const container = dockerOk([
    'run',
    '--detach',
    // No --rm: if the engine crashes, its logs must still be readable; stopEngine removes it.
    '--name',
    options.name,
    '--shm-size',
    '1g',
    '--publish',
    '127.0.0.1::9223',
    // The Lablo Lab reports to a mock provider on the host (step 15a, src/lab.ts).
    '--add-host',
    'host.docker.internal:host-gateway',
    '--mount',
    `type=bind,source=${path.resolve(options.zip)},target=/engine.zip,readonly`,
    '--mount',
    `type=bind,source=${path.resolve(options.appDir)},target=/app,readonly`,
    ...(options.zone === undefined ? [] : ['--env', `TZ=${options.zone}`]),
    options.image,
    ...(options.chromeFlags ?? []),
  ]);
  const mapping = dockerOk(['port', container, '9223/tcp']);
  // "127.0.0.1:49153" (one line per published address).
  const port = Number(/:(\d+)\s*$/m.exec(mapping.split('\n')[0] ?? '')?.[1]);
  if (!Number.isInteger(port) || port <= 0) {
    stopEngine(container);
    throw new Error(`could not read the published DevTools port from "${mapping}"`);
  }
  return { container, port };
}

export function engineLogs(container: string): string {
  const result = docker(['logs', container]);
  return `${result.stdout}${result.stderr}`.trim();
}

export function stopEngine(container: string): void {
  docker(['rm', '--force', container]);
}
