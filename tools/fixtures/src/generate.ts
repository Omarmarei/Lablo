// Runs every fixture writer and records a manifest (sizes, SHA-256, counts, timings).

import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { CatalogCounts, CatalogResult } from './catalog';
import { FULL_COUNTS, writeCatalog } from './catalog';
import type { WrittenFile } from './writer';
import type { XmltvResult, XmltvSpec } from './xmltv';
import { XMLTV_SPECS, writeXmltv } from './xmltv';

export const DEFAULT_SEED = 20_261_102;
export const DEFAULT_FIXTURES_OUT = join(import.meta.dirname, '..', '..', '..', '.cache', 'fixtures');
/** RELAY step 4 "Done when": all fixtures generate in under 2 minutes. */
export const TIME_LIMIT_MS = 120_000;

export interface GenerateOptions {
  outDir?: string;
  seed?: number;
  catalog?: boolean;
  xmltv?: boolean;
  counts?: CatalogCounts;
  xmltvSpecs?: readonly XmltvSpec[];
  log?: (line: string) => void;
}

export interface FixtureManifest {
  seed: number;
  ms: number;
  catalog?: CatalogResult['counts'] & { ms: number };
  xmltv: (Omit<XmltvResult, 'file'> & { name: string; ms: number })[];
  files: Record<string, { bytes: number; sha256: string; gzBytes?: number }>;
}

export async function generateFixtures(options: GenerateOptions = {}): Promise<FixtureManifest> {
  const started = Date.now();
  const outDir = options.outDir ?? DEFAULT_FIXTURES_OUT;
  const seed = options.seed ?? DEFAULT_SEED;
  const log = options.log ?? (() => {});
  await mkdir(join(outDir, 'xtream'), { recursive: true });
  const manifest: FixtureManifest = { seed, ms: 0, xmltv: [], files: {} };
  const record = (f: WrittenFile): void => {
    manifest.files[relative(outDir, f.path).replace(/\\/g, '/')] = { bytes: f.bytes, sha256: f.sha256, ...(f.gzBytes !== undefined ? { gzBytes: f.gzBytes } : {}) };
  };

  const jobs: Promise<void>[] = [];
  if (options.catalog !== false) {
    jobs.push(
      (async () => {
        const t0 = Date.now();
        const result = await writeCatalog({ outDir, seed, counts: options.counts ?? FULL_COUNTS });
        result.files.forEach(record);
        manifest.catalog = { ...result.counts, ms: Date.now() - t0 };
        log(`catalog: ${result.counts.live} live, ${result.counts.movies} movies, ${result.counts.episodes} episodes (${Date.now() - t0} ms)`);
      })(),
    );
  }
  if (options.xmltv !== false) {
    // Interleaved on one thread; gzip runs on the libuv pool in parallel.
    for (const spec of options.xmltvSpecs ?? XMLTV_SPECS) {
      jobs.push(
        (async () => {
          const t0 = Date.now();
          const { file, ...rest } = await writeXmltv(outDir, spec, seed);
          record(file);
          manifest.xmltv.push({ name: spec.name, ...rest, ms: Date.now() - t0 });
          log(`${spec.name}: ${(file.bytes / 1e6).toFixed(1)} MB, gz ${((file.gzBytes ?? 0) / 1e6).toFixed(1)} MB, ${rest.programmes} programmes (${Date.now() - t0} ms)`);
        })(),
      );
    }
  }
  await Promise.all(jobs);
  // Code-point order, the same on every machine (localeCompare is not).
  const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  manifest.xmltv.sort((a, b) => byName(a.name, b.name));
  manifest.files = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => byName(a, b)));
  manifest.ms = Date.now() - started;
  await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}
