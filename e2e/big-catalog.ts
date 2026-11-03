import { writeFileSync } from 'node:fs';
import type { Catalog, Category, LiveChannel } from '../apps/mock-provider/src/config';
import { escapeXml } from '../apps/mock-provider/src/xmltv';

/**
 * A large live catalog for the mock, built in-process (RELAY step 14b): `pnpm verify` has no
 * `.cache/fixtures`. Provider-like names in English, Arabic and French, long category names,
 * the panel's own numbers, and a guide for most channels.
 */
export interface BigCatalogOptions {
  readonly channels: number;
  readonly categories: number;
}

/** Every `NO_GUIDE_EVERY`th channel has no guide id: its row says so. */
export const NO_GUIDE_EVERY = 10;

const GROUPS = ['EN | News', 'AR | أخبار', 'Sports HD', 'AR | MBC Group HD', 'FR | Cinéma', 'Kids | أطفال', 'ES | Deportes', 'Documentary 4K'] as const;
const NAMES = ['Zoma Test {n} HD', 'قناة الاختبار {n}', 'Test Channel {n} FHD', 'Zoma Radio {n}', 'Chaîne Test {n}'] as const;

function fill(pattern: string, n: number): string {
  return pattern.replace('{n}', String(n));
}

/** `channels` live channels spread evenly over `categories` categories, numbered 1… in category order. */
export function bigCatalog({ channels, categories }: BigCatalogOptions): Catalog {
  const liveCategories: Category[] = Array.from({ length: categories }, (_v, i) => ({ id: 1000 + i, name: `${GROUPS[i % GROUPS.length]} ${i + 1}`, parentId: 0 }));
  const live: LiveChannel[] = Array.from({ length: channels }, (_v, j) => ({
    id: 100_000 + j,
    num: j + 1,
    name: fill(NAMES[j % NAMES.length]!, j + 1),
    categoryId: 1000 + Math.floor((j * categories) / channels),
    epgId: j % NO_GUIDE_EVERY === NO_GUIDE_EVERY - 1 ? null : `big${j + 1}.zoma`,
    xmltvId: null,
    logo: false,
    archiveDays: 0,
    catchup: null,
    radio: false,
    adult: false,
    addedDaysAgo: 1,
    media: 'clock',
  }));
  return { liveCategories, vodCategories: [], seriesCategories: [], live, movies: [], series: [] };
}

const SLOT_MS = 2 * 3_600_000;
const TITLES = ['Evening News', 'نشرة الأخبار المسائية', 'Match of the Day', 'Le Journal', 'برنامج الأطفال', 'Documentary Hour'] as const;

/** XMLTV time: `20261102120000 +0000`. */
function xmltvTime(ms: number): string {
  return `${new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14)} +0000`;
}

/**
 * Writes a guide for every channel with a guide id: three 2-hour programmes around `now` (the
 * one before, the one on, the next), so each row has now/next. A short window keeps the file
 * small (the mock's own guide covers days per channel).
 */
export function writeBigGuide(catalog: Catalog, now: number, file: string): number {
  const first = Math.floor(now / SLOT_MS) * SLOT_MS - SLOT_MS;
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv generator-info-name="Zoma e2e big catalog">'];
  const guided = catalog.live.filter((c) => c.epgId !== null);
  for (const c of guided) out.push(`<channel id="${c.epgId!}"><display-name>${escapeXml(c.name)}</display-name></channel>`);
  let count = 0;
  for (const c of guided) {
    for (let k = 0; k < 3; k++) {
      const start = first + k * SLOT_MS;
      const title = `${TITLES[(c.id + k) % TITLES.length]!} ${k + 1}`;
      out.push(`<programme start="${xmltvTime(start)}" stop="${xmltvTime(start + SLOT_MS)}" channel="${c.epgId!}"><title>${escapeXml(title)}</title></programme>`);
      count++;
    }
  }
  out.push('</tv>', '');
  writeFileSync(file, out.join('\n'), 'utf8');
  return count;
}
