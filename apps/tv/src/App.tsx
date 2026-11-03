import type { ReadonlySignal } from '@preact/signals';
import { useSignal } from '@preact/signals';
import type { DeviceInfo, Intent, LifecycleEvent, Platform } from '@zoma/platform-api';
import { connectRemote, localeDir } from '@zoma/ui';
import { useEffect } from 'preact/hooks';
import { DataPanel } from './DataPanel';
import { FocusPanel } from './FocusPanel';
import type { DataEngine } from './data/engine';
import type { DebugParams } from './data/params';
import type { FocusDemo } from './focus-demo';
import { pingHelloWorker } from './hello-worker';

/** The data workers and the catalog debug parameters (RELAY step 8b). */
export interface AppData {
  readonly engine: DataEngine;
  readonly params: DebugParams;
  /** True while remote keys are being pressed (a running refresh is paused). */
  readonly busy: ReadonlySignal<boolean>;
}

interface Props {
  readonly platform: Platform;
  readonly keyHelp: ReadonlyArray<readonly [string, string]>;
  readonly data: AppData;
  /** The focus engine and its demo screens (relay step 10). */
  readonly focus: FocusDemo;
}

const INFO_ROWS: ReadonlyArray<readonly [keyof DeviceInfo, string]> = [
  ['platform', 'Platform'],
  ['model', 'Model'],
  ['modelYear', 'Model year'],
  ['osVersion', 'OS version'],
  ['firmware', 'Firmware'],
  ['chromiumVersion', 'Chromium'],
  ['tier', 'Tier'],
  ['locale', 'Locale'],
  ['country', 'Country'],
];

/** `09:05:03`. padStart is missing in Chromium 53, so this also exercises core-js. */
function clock(date: Date): string {
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The hello screen (relay step 2): device facts, the worker round trip and the last remote
 * key as an Intent. Step 8b added the catalog panel (the data workers), step 10 the focus
 * engine: every key goes to it, and Back on the root follows the platform's
 * `rootBackPolicy`. The onboarding and browse screens (steps 13 and 14) replace it.
 */
export function App({ platform, keyHelp, data, focus }: Props) {
  const info = useSignal<DeviceInfo | null>(null);
  const infoError = useSignal<string | null>(null);
  const worker = useSignal('starting…');
  const idb = useSignal('checking…');
  const lastIntent = useSignal<Intent | null>(null);
  const keyCount = useSignal(0);
  const lifecycle = useSignal<LifecycleEvent | 'started'>('started');
  const startedAt = useSignal(clock(new Date()));
  const lowTier = (): Promise<boolean> =>
    platform.info().then(
      (value) => value.tier === 'low',
      () => false,
    );

  useEffect(() => {
    platform.info().then(
      (value) => {
        info.value = value;
        const dir = localeDir(value.locale);
        focus.nav.setDir(dir);
        // app.css's mirrored rules (postcss-rtlcss) follow dir on <html>; lang picks the
        // locale's glyph forms and lets :lang() rules apply.
        document.documentElement.lang = value.locale;
        document.documentElement.dir = dir;
      },
      (error: unknown) => {
        infoError.value = message(error);
      },
    );

    pingHelloWorker().then(
      (report) => {
        worker.value = `ok in ${report.roundTripMs} ms (${report.features.join(', ')})`;
        idb.value = report.idb;
      },
      (error: unknown) => {
        worker.value = `failed: ${message(error)}`;
        idb.value = 'failed: no worker';
      },
    );

    // Keys, the Magic Remote pointer and the wheel go to the focus engine.
    const disconnect = connectRemote({
      platform,
      nav: focus.nav,
      target: window,
      onIntent: (intent) => {
        // Pauses a running catalog refresh until the keys are idle (architecture.md §1.4).
        data.engine.noteActivity();
        lastIntent.value = intent;
        keyCount.value += 1;
      },
    });
    const stopLifecycle = platform.onLifecycle((event) => {
      lifecycle.value = event;
    });
    return () => {
      disconnect();
      stopLifecycle();
    };
  }, [platform, data, focus]);

  const device = info.value;
  return (
    <main class="hello" data-testid="hello" data-ready={device === null ? 'false' : 'true'}>
      <h1 class="hello__title" data-testid="title">
        Zoma
        <span class="hello__brand-ar" lang="ar">
          زوما
        </span>
      </h1>
      <p class="hello__subtitle">
        Hello from <span data-testid="platform-id">{platform.id}</span> · started {startedAt}
      </p>

      <div class="hello__panels">
        <section class="hello__panel">
          <h2>Device</h2>
          {infoError.value !== null && <p class="hello__error">Device info failed: {infoError.value}</p>}
          <table class="hello__info">
            <tbody>
              {INFO_ROWS.map(([key, label]) => (
                <tr key={key}>
                  <th>{label}</th>
                  <td data-testid={`info-${key}`}>{device === null ? '…' : String(device[key] ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p class="hello__row">
            Worker: <span data-testid="worker-status">{worker}</span>
          </p>
          <p class="hello__row">
            IndexedDB (in the worker): <span data-testid="idb-status">{idb}</span>
          </p>
          <p class="hello__row">
            Lifecycle: <span data-testid="lifecycle">{lifecycle}</span>
          </p>
        </section>

        <section class="hello__panel">
          <h2>Remote</h2>
          <p class="hello__intent" data-testid="last-intent">
            {lastIntent.value ?? 'Press a key'}
          </p>
          <p class="hello__row">
            Keys pressed: <span data-testid="key-count">{keyCount}</span>
          </p>
          {focus.exitRequested.value && (
            <p class="hello__notice" data-testid="exit-requested">
              Back: exit requested
            </p>
          )}
          <FocusPanel demo={focus} />
          <table class="hello__keys">
            <tbody>
              {keyHelp.map(([keys, action]) => (
                <tr key={keys}>
                  <th>{keys}</th>
                  <td>{action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <DataPanel engine={data.engine} params={data.params} lowTier={lowTier} busy={data.busy} />
      </div>
    </main>
  );
}
