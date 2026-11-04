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
  return `zoma-old-engines:${hash.digest('hex').slice(0, 12)}`;
}

export function ensureImage(dockerDir: string, log: (line: string) => void): string {
  const tag = imageTag(dockerDir);
  if (docker(['image', 'inspect', tag]).status === 0) return tag;
  log(`building Docker image ${tag}`);
  const build = docker(['build', '-t', tag, dockerDir], { inherit: true });
  if (build.status !== 0) throw new Error(`docker build of ${tag} failed`);
  return tag;
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
    // The Zoma Lab reports to a mock provider on the host (step 15a, src/lab.ts).
    '--add-host',
    'host.docker.internal:host-gateway',
    '--mount',
    `type=bind,source=${path.resolve(options.zip)},target=/engine.zip,readonly`,
    '--mount',
    `type=bind,source=${path.resolve(options.appDir)},target=/app,readonly`,
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
