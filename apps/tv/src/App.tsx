import { useSignal } from '@preact/signals';
import type { DeviceInfo, Intent, LifecycleEvent, Platform } from '@zoma/platform-api';
import { useEffect } from 'preact/hooks';
import { pingHelloWorker } from './hello-worker';

interface Props {
  readonly platform: Platform;
  readonly keyHelp: ReadonlyArray<readonly [string, string]>;
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
 * key as an Intent. Back exits the app the platform's way.
 */
export function App({ platform, keyHelp }: Props) {
  const info = useSignal<DeviceInfo | null>(null);
  const infoError = useSignal<string | null>(null);
  const worker = useSignal('starting…');
  const idb = useSignal('checking…');
  const lastIntent = useSignal<Intent | null>(null);
  const keyCount = useSignal(0);
  const lifecycle = useSignal<LifecycleEvent | 'started'>('started');
  const exitRequested = useSignal(false);
  const startedAt = useSignal(clock(new Date()));

  useEffect(() => {
    platform.info().then(
      (value) => {
        info.value = value;
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

    const onKey = (event: KeyboardEvent): void => {
      const intent = platform.keyToIntent(event);
      if (intent === null) return;
      event.preventDefault();
      lastIntent.value = intent;
      keyCount.value += 1;
      if (intent === 'BACK') {
        exitRequested.value = true;
        platform.exitApp();
      }
    };
    window.addEventListener('keydown', onKey);
    const stopLifecycle = platform.onLifecycle((event) => {
      lifecycle.value = event;
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      stopLifecycle();
    };
  }, [platform]);

  const device = info.value;
  return (
    <main class="hello" data-testid="hello" data-ready={device === null ? 'false' : 'true'}>
      <h1 class="hello__title">Zoma</h1>
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
          {exitRequested.value && (
            <p class="hello__notice" data-testid="exit-requested">
              Back: exit requested
            </p>
          )}
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
      </div>
    </main>
  );
}
