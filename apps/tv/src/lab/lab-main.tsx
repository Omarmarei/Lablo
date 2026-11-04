/**
 * The Zoma Lab (RELAY step 15a, docs/architecture.md §5): a separate TV build (`dist/tv-lab`,
 * its own app id) that answers the hardware spikes on a real TV and sends every result to the
 * LAN log collector, since Claude can't see the TV. `lab.html` runs it under `pnpm dev`.
 */
import { render } from 'preact';
import { Spinner } from '@zoma/ui';
import { createPlatform } from '../platform';
import { installTestHook } from '../test-hook';
import type { LabBuildConfig } from './config';
import { labSession, readLabConfig } from './config';
import { createLab } from './lab-state';
import { LabApp } from './LabApp';
import LabWorker from './lab.worker?worker';
import { createReporter, xhrPost } from './reporter';
import { deviceIdHash } from './spikes/s2-s3';
import { SPIKES } from './spikes';
import { readIdbMarker, readLocalMarker } from './storage';
import type { LabContext } from './types';
import { createLabWorkerClient } from './worker-client';
// Last, so the lab's CSS comes after @zoma/ui's.
import './lab.css';

/** This launch's boot: the page's start (navigation) to here, after every module has run. */
const BOOT_MS = performance.now();

const platform = createPlatform();
platform.registerKeys();
const showFocus = installTestHook(window);

const root = document.getElementById('app');
if (root === null) throw new Error('#app element missing from index.html');

function showError(text: string): void {
  render(
    <main class="lab is-loading" data-testid="lab" data-ready="error">
      <p class="lab__error" data-testid="lab-error">
        {text}
      </p>
    </main>,
    root as Element,
  );
}

function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

async function start(): Promise<void> {
  const info = await platform.info();
  const built = (window as unknown as { ZOMA_LAB_CONFIG?: LabBuildConfig }).ZOMA_LAB_CONFIG;
  const config = readLabConfig(location.search, built, location.hostname);
  const session = labSession(info, new Date(), Math.random);
  const id = await platform.deviceSecret().catch(() => null);
  // What earlier runs left here, read before any check writes this run's markers.
  const previous = { localStorage: readLocalMarker(localStorageOrNull()), indexedDB: await readIdbMarker(window.indexedDB ?? null) };
  const context: LabContext = {
    platform,
    info,
    server: config.server,
    session,
    version: config.version,
    writeMb: config.writeMb,
    previous,
    deviceIdHash: deviceIdHash(id),
    bootMs: BOOT_MS,
    worker: createLabWorkerClient(() => new LabWorker()),
  };
  const reporter = createReporter({ server: config.server, session, post: xhrPost });
  reporter.add({ type: 'start', value: { version: config.version, server: config.server, writeMb: config.writeMb, autoRun: config.autoRun, device: info, previous } });
  const lab = createLab({ platform, spikes: SPIKES, context, reporter });
  window.__ZOMA_LAB__ = {
    session,
    server: config.server,
    records: reporter.records,
    phase: () => lab.phase.peek(),
    runs: () => lab.runs.peek(),
    sent: () => reporter.state.peek(),
  };
  showFocus(lab.nav);
  render(<LabApp platform={platform} lab={lab} />, root as Element);
  if (config.autoRun) void lab.runAll();
}

render(
  <main class="lab is-loading" data-testid="lab" data-ready="false">
    <Spinner size="l" />
  </main>,
  root,
);
start().catch((error: unknown) => showError(`The lab could not start: ${error instanceof Error ? error.message : String(error)}`));
