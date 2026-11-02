import type { ReadonlySignal } from '@preact/signals';
import { useSignal } from '@preact/signals';
import type { ContentKind } from '@zoma/core';
import type { IngestResult } from '@zoma/data';
import { useEffect } from 'preact/hooks';
import type { DataEngine, DataSummary } from './data/engine';
import type { DebugParams } from './data/params';

/** The source id the debug refresh writes under. */
export const DEBUG_SOURCE = 'debug';

interface Props {
  readonly engine: DataEngine;
  readonly params: DebugParams;
  /** Resolves true on a low-tier TV (the refresh then runs the duty cycle). */
  readonly lowTier: () => Promise<boolean>;
  readonly busy: ReadonlySignal<boolean>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function describeSummary(summary: DataSummary): string {
  const stale = summary.stale > 0 ? `, ${summary.stale} stale` : '';
  return `ok: ${plural(summary.sources, 'source')}, ${plural(summary.items, 'item')}${stale}`;
}

function itemCount(result: IngestResult): number {
  let total = 0;
  for (const kind of Object.keys(result.counts) as ContentKind[]) total += result.counts[kind] ?? 0;
  return total;
}

function describeRefresh(result: IngestResult): string {
  const kinds = (Object.keys(result.counts) as ContentKind[]).map((kind) => `${kind} ${result.counts[kind] ?? 0}`).join(', ');
  const gzip = result.gzipped ? ', gzip' : '';
  return `ok: ${result.status} gen ${result.gen}, ${plural(itemCount(result), 'item')} (${kinds})${gzip}, ${result.elapsedMs} ms`;
}

/**
 * The hello screen's catalog panel (RELAY step 8b): the data workers end to end. At start it
 * prunes and shows what the query worker holds; with `?source=` it refreshes that playlist in an
 * ingest worker; with `?q=` it searches the catalog through the query worker. Remote keys mark
 * the UI busy, which pauses a running refresh. The old-engine harness reads these statuses.
 */
export function DataPanel({ engine, params, lowTier, busy }: Props) {
  const data = useSignal('starting…');
  const ingest = useSignal('waiting…');
  const ingestItems = useSignal<number | null>(null);
  const gzipped = useSignal(false);
  const search = useSignal('waiting…');
  const searchTotal = useSignal<number | null>(null);

  useEffect(() => {
    let alive = true;
    const set = (apply: () => void): void => {
      if (alive) apply();
    };

    const runSearch = async (query: string): Promise<void> => {
      set(() => (search.value = 'running…'));
      try {
        const result = await engine.search(query);
        const names = result.names.length === 0 ? '' : `: ${result.names.join(', ')}`;
        set(() => {
          searchTotal.value = result.total;
          search.value = `ok: ${result.total} for "${query}"${names}`;
        });
      } catch (error) {
        set(() => (search.value = `failed: ${message(error)}`));
      }
    };

    const run = async (): Promise<void> => {
      try {
        await engine.start();
        const summary = await engine.summary();
        set(() => (data.value = describeSummary(summary)));
      } catch (error) {
        set(() => {
          data.value = `failed: ${message(error)}`;
          ingest.value = 'failed: no data workers';
          search.value = 'failed: no data workers';
        });
        return;
      }

      if (params.error !== null) set(() => (ingest.value = `failed: ${params.error}`));
      else if (params.source === null) set(() => (ingest.value = 'none: add ?source=<playlist URL> as the last parameter'));
      else {
        const url = params.source;
        set(() => (ingest.value = 'running…'));
        try {
          const result = await engine.refresh(
            { src: DEBUG_SOURCE, source: { type: 'm3u', url }, force: params.force },
            {
              lowTier: await lowTier(),
              onProgress: (progress) => set(() => (ingest.value = `running: ${Math.round(progress.bytes / 1024)} KB, ${plural(progress.items, 'item')}`)),
            },
          );
          set(() => {
            ingestItems.value = itemCount(result);
            gzipped.value = result.gzipped;
            ingest.value = describeRefresh(result);
          });
          const summary = await engine.summary();
          set(() => (data.value = describeSummary(summary)));
        } catch (error) {
          set(() => (ingest.value = `failed: ${message(error)}`));
        }
      }

      if (params.query === null) set(() => (search.value = 'none: add ?q=<words>'));
      else await runSearch(params.query);
    };
    void run();
    return () => {
      alive = false;
    };
  }, [engine, params]);

  return (
    <section class="hello__panel">
      <h2>Catalog</h2>
      <p class="hello__row">
        Data workers: <span data-testid="data-status">{data}</span>
      </p>
      <p class="hello__row">
        Refresh:{' '}
        <span data-testid="ingest-status" data-items={ingestItems.value ?? ''} data-gzip={gzipped.value ? 'true' : 'false'}>
          {ingest}
        </span>
      </p>
      <p class="hello__row">
        Search:{' '}
        <span data-testid="search-status" data-total={searchTotal.value ?? ''}>
          {search}
        </span>
      </p>
      <p class="hello__row">
        Remote: <span data-testid="busy-status">{busy.value ? 'busy (refresh paused)' : 'idle'}</span>
      </p>
    </section>
  );
}
