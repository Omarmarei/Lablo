import type { ReadonlySignal } from '@preact/signals';
import { useSignal } from '@preact/signals';
import type { ContentKey, ContentKind } from '@zoma/core';
import type { EpgNowNext, EpgRefreshResult, EpgStatus, IngestResult, ShortEpgNowNext } from '@zoma/data';
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

function percent(part: number, whole: number): string {
  return whole > 0 ? `${((100 * part) / whole).toFixed(1)}%` : '-';
}

/** Live channels the stored guides cover (every guide matches the same wanted set). */
function guideWanted(status: EpgStatus): number {
  let wanted = 0;
  for (const g of status.guides) if (g.summary && g.summary.wanted > wanted) wanted = g.summary.wanted;
  return wanted;
}

function describeEpg(status: EpgStatus, result: EpgRefreshResult | null): string {
  const failed = result === null ? [] : result.outcomes.filter((o) => o.error !== null);
  const failures = failed.map((o) => `${o.epgSrc} ${o.error === null ? '' : o.error.code}`).join(', ');
  const active = status.guides.filter((g) => g.gen > 0).length;
  if (active === 0) return failed.length > 0 ? `failed: ${failures}` : 'none: no guide stored (the playlist names none)';
  const wanted = guideWanted(status);
  const notes = failed.length > 0 ? `; failed: ${failures}` : '';
  return `ok: ${status.matched} of ${plural(wanted, 'live channel')} have a guide (${percent(status.matched, wanted)}), ${plural(active, 'guide')}${notes}`;
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** Local wall time of an epoch minute. */
function hhmm(minute: number): string {
  const d = new Date(minute * 60_000);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function describeNowNext(name: string, n: EpgNowNext): string {
  const now = n.now === null ? 'nothing on air' : `${n.now.title} ${hhmm(n.now.start)}–${hhmm(n.now.end)}`;
  const next = n.next === null ? '' : `, next ${n.next.title} ${hhmm(n.next.start)}`;
  return `ok: ${name}: ${now}${next}`;
}

/** Live channels the panel looks through for one no guide matches. */
const SHORT_EPG_SCAN = 200;

function describeShortEpg(name: string, n: ShortEpgNowNext): string {
  if (n.from === 'none') return `none: ${name}: its playlist is no Xtream panel's (get.php)`;
  if (n.now === null && n.next === null) return `none: ${name}: the panel has no programmes for it now`;
  const answer = describeNowNext(name, n);
  return `${answer} (${n.from === 'panel' ? 'panel' : 'guide'}${n.cached ? ', cached' : ''})`;
}

function describeRefresh(result: IngestResult): string {
  const kinds = (Object.keys(result.counts) as ContentKind[]).map((kind) => `${kind} ${result.counts[kind] ?? 0}`).join(', ');
  const gzip = result.gzipped ? ', gzip' : '';
  return `ok: ${result.status} gen ${result.gen}, ${plural(itemCount(result), 'item')} (${kinds})${gzip}, ${result.elapsedMs} ms`;
}

/**
 * The hello screen's catalog panel (RELAY steps 8b, 9b and 9c): the data workers end to end. At
 * start it prunes and shows what the query worker holds; with `?source=` it refreshes that
 * playlist in an ingest worker, then the guides its header names in an EPG worker (only when
 * due, unless `?force=1`); with `?q=` it searches the catalog through the query worker. It shows
 * the guides' match rate and the now/next of the first search hit with a guide (or of the first
 * live channels). With `?source=`, it then focuses the first live channel no guide matches, as
 * the remote would, and shows what the short-EPG fallback gives after 600 ms. Remote keys mark
 * the UI busy, which pauses a running refresh. The old-engine harness reads these statuses.
 */
export function DataPanel({ engine, params, lowTier, busy }: Props) {
  const data = useSignal('starting…');
  const ingest = useSignal('waiting…');
  const ingestItems = useSignal<number | null>(null);
  const gzipped = useSignal(false);
  const search = useSignal('waiting…');
  const searchTotal = useSignal<number | null>(null);
  const epg = useSignal('waiting…');
  const epgMatched = useSignal<number | null>(null);
  const epgWanted = useSignal<number | null>(null);
  const onAir = useSignal('waiting…');
  const shortEpg = useSignal('waiting…');
  const shortEpgFrom = useSignal('');

  useEffect(() => {
    let alive = true;
    const set = (apply: () => void): void => {
      if (alive) apply();
    };

    /** Live channels to show now/next for: the search hits, then the debug source's first ones. */
    let candidates: { key: ContentKey; name: string }[] = [];

    const runSearch = async (query: string): Promise<void> => {
      set(() => (search.value = 'running…'));
      try {
        const result = await engine.search(query);
        const names = result.names.length === 0 ? '' : `: ${result.names.join(', ')}`;
        candidates = result.keys.map((key, i) => ({ key, name: result.names[i] ?? '?' })).filter((c, i) => result.live[i] === true && c.key !== '');
        set(() => {
          searchTotal.value = result.total;
          search.value = `ok: ${result.total} for "${query}"${names}`;
        });
      } catch (error) {
        set(() => (search.value = `failed: ${message(error)}`));
      }
    };

    const runEpg = async (refresh: boolean): Promise<void> => {
      let result: EpgRefreshResult | null = null;
      if (refresh) {
        set(() => (epg.value = 'running…'));
        try {
          result = await engine.refreshEpg([{ src: DEBUG_SOURCE, type: 'm3u' }], {
            tier: (await lowTier()) ? 'low' : 'full',
            languages: ['en'],
            due: !params.force,
            force: params.force,
            onProgress: (p) => set(() => (epg.value = `running: ${Math.round(p.bytes / 1024)} KB, ${plural(p.kept, 'programme')}`)),
          });
        } catch (error) {
          set(() => (epg.value = `failed: ${message(error)}`));
          return;
        }
      }
      try {
        const status = await engine.epgStatus();
        set(() => {
          epgMatched.value = status.matched;
          epgWanted.value = guideWanted(status);
          epg.value = describeEpg(status, result);
        });
        const cats = await engine.query.call('categories', { src: DEBUG_SOURCE, kind: 'live' });
        const first = cats[0];
        const items = first === undefined ? [] : await engine.query.call('chunk', { src: DEBUG_SOURCE, kind: 'live', catIdx: first.catIdx, chunk: 0 });
        for (const i of items.slice(0, 50)) candidates.push({ key: i.key, name: i.name });
        const all = candidates.length === 0 ? [] : await engine.nowNext(candidates.map((c) => c.key));
        const found = all.findIndex((n) => n.now !== null || n.next !== null);
        set(() => (onAir.value = found === -1 ? 'none: no channel here has programmes now' : describeNowNext(candidates[found]!.name, all[found]!)));
      } catch (error) {
        set(() => (onAir.value = `failed: ${message(error)}`));
      }
    };

    /** The first live channel of the debug source no guide matches, focused as the remote would. */
    const runShortEpg = async (url: string): Promise<void> => {
      try {
        let target: { key: ContentKey; name: string; url: string } | null = null;
        let seen = 0;
        for (const cat of await engine.query.call('categories', { src: DEBUG_SOURCE, kind: 'live' })) {
          for (let n = 0; n < cat.chunks.length && target === null && seen < SHORT_EPG_SCAN; n++) {
            const items = (await engine.query.call('chunk', { src: DEBUG_SOURCE, kind: 'live', catIdx: cat.catIdx, chunk: n })).slice(0, SHORT_EPG_SCAN - seen);
            seen += items.length;
            const stored = items.length === 0 ? [] : await engine.nowNext(items.map((i) => i.key));
            const at = stored.findIndex((s) => s.epgSrc === null);
            const hit = items[at];
            if (hit !== undefined) target = { key: hit.key, name: hit.name, url: hit.url };
          }
          if (target !== null || seen >= SHORT_EPG_SCAN) break;
        }
        if (target === null) {
          set(() => (shortEpg.value = 'none: every live channel here has a guide'));
          return;
        }
        const name = target.name;
        set(() => (shortEpg.value = `focused: ${name}…`));
        const answer = await engine.focusChannel({ key: target.key, url: target.url, source: { type: 'm3u', url } });
        if (answer === null) return;
        set(() => {
          shortEpgFrom.value = answer.from;
          shortEpg.value = describeShortEpg(name, answer);
        });
      } catch (error) {
        set(() => (shortEpg.value = `failed: ${message(error)}`));
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
          epg.value = 'failed: no data workers';
          onAir.value = 'failed: no data workers';
          shortEpg.value = 'failed: no data workers';
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
      await runEpg(params.source !== null && params.error === null);
      if (params.source === null || params.error !== null) set(() => (shortEpg.value = "none: needs ?source=<an Xtream panel's get.php URL>"));
      else await runShortEpg(params.source);
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
        Guide:{' '}
        <span data-testid="epg-status" data-matched={epgMatched.value ?? ''} data-wanted={epgWanted.value ?? ''}>
          {epg}
        </span>
      </p>
      <p class="hello__row">
        On air: <span data-testid="nownext-status">{onAir}</span>
      </p>
      <p class="hello__row">
        Panel EPG:{' '}
        <span data-testid="shortepg-status" data-from={shortEpgFrom.value}>
          {shortEpg}
        </span>
      </p>
      <p class="hello__row">
        Remote: <span data-testid="busy-status">{busy.value ? 'busy (refresh paused)' : 'idle'}</span>
      </p>
    </section>
  );
}
