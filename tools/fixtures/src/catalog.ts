// The 200k-item scale catalog (architecture.md §4 "Scale fixtures"): 20k live channels, 120k
// movies and 60k episodes, with Arabic, English, French and Spanish names, duplicates, quality
// and country tags, catch-up channels and adult groups. One pass writes three shapes:
// - playlist.m3u: m3u_plus with malformed lines mixed in (counted in the manifest);
// - xtream/*.json: the Xtream list responses (categories, live_streams, vod_streams, series);
// - catalog.json: the mock provider's catalog schema, for `pnpm mock --catalog`.
// All names are invented; no real channel or film names.

import { join } from 'node:path';
import { Rng } from './prng';
import type { WrittenFile } from './writer';
import { FixtureWriter } from './writer';

export type Lang = 'ar' | 'en' | 'fr' | 'es';

export interface CatalogCounts {
  live: number;
  movies: number;
  series: number;
  episodesPerSeries: number;
}

export const FULL_COUNTS: CatalogCounts = { live: 20_000, movies: 120_000, series: 3_000, episodesPerSeries: 20 };
/** EPG channel ids the live channels point at (the 300 MB XMLTV has all of them). */
export const EPG_CHANNELS = 5_000;
export const epgId = (k: number): string => `epg${k}.lablo.test`;

/** Id ranges (one id space, like a panel's stream ids). */
const LIVE_BASE = 100_000;
const MOVIE_BASE = 200_000;
const SERIES_BASE = 400_000;
const EPISODE_BASE = 500_000;
/** Fixed "now" for `added` timestamps, so output never depends on the clock. */
export const ANCHOR_SEC = Date.UTC(2026, 10, 1) / 1000;

const COUNTRIES: { code: string; lang: Lang }[] = [
  { code: 'AR', lang: 'ar' }, { code: 'SA', lang: 'ar' }, { code: 'AE', lang: 'ar' }, { code: 'EG', lang: 'ar' },
  { code: 'KW', lang: 'ar' }, { code: 'UK', lang: 'en' }, { code: 'US', lang: 'en' }, { code: 'CA', lang: 'en' },
  { code: 'FR', lang: 'fr' }, { code: 'BE', lang: 'fr' }, { code: 'ES', lang: 'es' }, { code: 'MX', lang: 'es' },
];

const GENRES: Record<Lang, string[]> = {
  en: ['News', 'Sport', 'Movies', 'Kids', 'Music', 'Docs', 'Drama', 'Comedy', 'Weather', 'Business'],
  // Mixed spellings on purpose: alef forms, taa marbuta/haa, alef maqsura/yaa, diacritics, tatweel.
  ar: ['أخبار', 'رِياضة', 'أفلام', 'أطفال', 'موسيقى', 'وثائقي', 'دراما', 'كوميديا', 'الطقس', 'اقتـصاد'],
  fr: ['Infos', 'Sport', 'Cinéma', 'Jeunesse', 'Musique', 'Découverte', 'Séries', 'Comédie', 'Météo', 'Économie'],
  es: ['Noticias', 'Deportes', 'Cine', 'Niños', 'Música', 'Documentales', 'Series', 'Comedia', 'Tiempo', 'Economía'],
};

const BRANDS: Record<Lang, string[]> = {
  en: ['Lablo', 'Nova', 'Lumen', 'Atlas', 'Orion', 'Cedar', 'Falcon', 'Delta', 'Harbor', 'Summit'],
  ar: ['لابلو', 'نوفا', 'الأطلس', 'الصحراء', 'النيل', 'الأرز', 'الصقر', 'دلتا', 'إشراق', 'الواحة'],
  fr: ['Lablo', 'Lumière', 'Horizon', 'Étoile', 'Rivage', 'Mistral', 'Azur', 'Delta', 'Phare', 'Sommet'],
  es: ['Lablo', 'Sol', 'Horizonte', 'Estrella', 'Oriente', 'Brisa', 'Cumbre', 'Delta', 'Faro', 'Señal'],
};

const WORDS: Record<Lang, string[]> = {
  en: ['Last', 'Night', 'City', 'Shadow', 'River', 'Golden', 'Silent', 'Broken', 'Hidden', 'Summer', 'Winter', 'Road', 'Storm', 'Island', 'Secret', 'Kingdom', 'Heart', 'Fire', 'Ghost', 'Garden'],
  ar: ['الليل', 'المدينة', 'الظل', 'النهر', 'الذهبي', 'الصامت', 'المكسور', 'الخفي', 'الصيف', 'الشتاء', 'الطريق', 'العاصفة', 'الجزيرة', 'السر', 'المملكة', 'القلب', 'النار', 'الشبح', 'الحديقة', 'الأخير'],
  fr: ['Dernière', 'Nuit', 'Ville', 'Ombre', 'Rivière', 'Doré', 'Silence', 'Brisé', 'Caché', 'Été', 'Hiver', 'Route', 'Tempête', 'Île', 'Secret', 'Royaume', 'Cœur', 'Feu', 'Fantôme', 'Jardin'],
  es: ['Última', 'Noche', 'Ciudad', 'Sombra', 'Río', 'Dorado', 'Silencio', 'Roto', 'Oculto', 'Verano', 'Invierno', 'Camino', 'Tormenta', 'Isla', 'Secreto', 'Reino', 'Corazón', 'Fuego', 'Fantasma', 'Jardín'],
};

const QUALITY = ['', '', '', ' HD', ' FHD', ' 4K', ' HEVC', ' SD', ' +1', ' ᴴᴰ'];
const PREFIX_STYLES = [(c: string) => `${c}: `, (c: string) => `${c} | `, (c: string) => `|${c}| `, (c: string) => `${c} - `, () => ''];
const CATCHUP = ['xc', 'default', 'append', 'shift', 'flussonic'] as const;
const EXTS = ['mp4', 'mp4', 'mp4', 'mkv', 'mkv', 'avi', 'ts'];
const EPISODE_WORD: Record<Lang, string> = { en: 'Episode', ar: 'الحلقة', fr: 'Épisode', es: 'Episodio' };
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const arabicDigits = (n: number): string => String(n).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]!);

interface Category {
  id: number;
  name: string;
  lang: Lang;
  adult: boolean;
}

function liveCategories(): Category[] {
  const out: Category[] = [];
  let id = 1;
  COUNTRIES.forEach((c, ci) => {
    GENRES[c.lang].forEach((g, gi) => {
      const sep = [' | ', ': ', ' - '][(ci + gi) % 3]!;
      out.push({ id: id++, name: `${c.code}${sep}${g}`, lang: c.lang, adult: false });
    });
  });
  for (const name of ['XXX Test', '18+ Test', 'للكبار فقط']) out.push({ id: id++, name, lang: 'en', adult: true });
  return out;
}

function vodCategories(base: number, variants: string[]): Category[] {
  const out: Category[] = [];
  let id = base;
  for (const lang of ['ar', 'en', 'fr', 'es'] as Lang[]) {
    for (const g of GENRES[lang]) for (const v of variants) out.push({ id: id++, name: `${lang.toUpperCase()} | ${g}${v}`, lang, adult: false });
  }
  return out;
}

function title(rng: Rng, lang: Lang, words: number): string {
  const parts: string[] = [];
  for (let i = 0; i < words; i++) parts.push(rng.pick(WORDS[lang]));
  return parts.join(' ');
}

function channelName(rng: Rng, cat: Category, n: number): string {
  const country = cat.name.split(/[ :|-]/)[0] ?? '';
  const prefix = cat.adult ? '' : rng.pick(PREFIX_STYLES)(country);
  const num = cat.lang === 'ar' && rng.chance(0.3) ? arabicDigits(n) : String(n);
  return `${prefix}${rng.pick(BRANDS[cat.lang])} ${rng.pick(GENRES[cat.lang])} ${num}${rng.pick(QUALITY)}`;
}

const esc = (s: string): string => s.replace(/"/g, "'");

/**
 * Broken M3U lines that tolerant parsers must survive: line `k` (k = 1, 2, …) is written before
 * entry `500k`, and is `MALFORMED[k % MALFORMED.length]`.
 */
export const MALFORMED = [
  '#EXTINF:-1 tvg-name="Unbalanced quote,Broken entry',
  '#EXTINF:-1,Entry without a URL',
  'http://scale.lablo.test/orphan/url-without-extinf.ts',
  '#EXTINF:abc tvg-id="bad.duration",Bad duration',
  '',
  '#EXTVLCOPT:http-user-agent=LabloTest/1.0',
  '#EXTGRP:Test Group',
  '#EXTINF:-1 tvg-id=noquotes group-title=Bare,Unquoted attributes',
  `#EXTINF:-1 tvg-name="${'Long name '.repeat(400)}",Very long name`,
];

export interface CatalogResult {
  files: WrittenFile[];
  counts: { live: number; movies: number; series: number; episodes: number; malformedLines: number; duplicateNames: number };
}

export interface CatalogOptions {
  outDir: string;
  seed: number;
  counts?: CatalogCounts;
  /** Base URL in the M3U (the mock: `pnpm mock --catalog <outDir>/catalog.json`). */
  baseUrl?: string;
}

export async function writeCatalog(options: CatalogOptions): Promise<CatalogResult> {
  const counts = options.counts ?? FULL_COUNTS;
  const base = options.baseUrl ?? 'http://127.0.0.1:8080';
  const auth = 'lablo/lablo-test';
  const rng = Rng.derive(options.seed, 'catalog');
  const liveCats = liveCategories();
  const vodCats = vodCategories(1000, ['', ' 4K', ' HD', ' Classics', ' Kids']);
  const seriesCats = vodCategories(2000, ['']);
  const normalLive = liveCats.filter((c) => !c.adult);
  const adultLive = liveCats.filter((c) => c.adult);

  const m3u = new FixtureWriter(join(options.outDir, 'playlist.m3u'));
  const catalog = new FixtureWriter(join(options.outDir, 'catalog.json'));
  const xt = (name: string): FixtureWriter => new FixtureWriter(join(options.outDir, 'xtream', `${name}.json`));
  const xLive = xt('live_streams');
  const xVod = xt('vod_streams');
  const xSeries = xt('series');
  const result: CatalogResult['counts'] = { live: 0, movies: 0, series: 0, episodes: 0, malformedLines: 0, duplicateNames: 0 };

  const epgUrl = `${base}/epg/guide.xml.gz`;
  await m3u.text(`#EXTM3U url-tvg="${epgUrl}" x-tvg-url="${epgUrl}"\n`);
  let entries = 0;
  const entry = async (extinf: string, url: string): Promise<void> => {
    if (++entries % 500 === 0) {
      const bad = MALFORMED[(entries / 500) % MALFORMED.length]!;
      await m3u.text(`${bad}\n`);
      result.malformedLines++;
    }
    await m3u.text(`${extinf}\n${url}\n`);
  };
  const cats = (list: Category[]): string => `[${list.map((c) => JSON.stringify({ category_id: String(c.id), category_name: c.name, parent_id: 0 })).join(',')}]`;
  const catalogCats = (list: Category[]): string => `[${list.map((c) => JSON.stringify({ id: c.id, name: c.name })).join(',')}]`;
  const writeSmall = async (name: string, list: Category[]): Promise<WrittenFile> => {
    const w = xt(name);
    await w.text(cats(list));
    return w.close();
  };

  await catalog.text(`{"live_categories":${catalogCats(liveCats)},"vod_categories":${catalogCats(vodCats)},"series_categories":${catalogCats(seriesCats)},\n"live":[\n`);
  await xLive.text('[');

  // ---- Live ---------------------------------------------------------------------------------
  const liveNames: { name: string; epg: string | null }[] = [];
  for (let i = 0; i < counts.live; i++) {
    const id = LIVE_BASE + i + 1;
    const cat = rng.chance(0.01) ? rng.pick(adultLive) : rng.pick(normalLive);
    let name: string;
    let epg: string | null;
    if (i > 0 && rng.chance(0.05)) {
      // The same channel in another group: the normal state of real playlists.
      const twin = liveNames[rng.int(0, i - 1)]!;
      name = twin.name;
      epg = twin.epg;
      result.duplicateNames++;
    } else {
      name = channelName(rng, cat, rng.int(1, 99));
      const r = rng.float();
      const k = i % EPG_CHANNELS;
      // Mostly matching ids, some with different case, some pointing nowhere, some absent.
      epg = r < 0.6 ? epgId(k) : r < 0.7 ? epgId(k).toUpperCase() : r < 0.75 ? `missing${i}.lablo.test` : null;
    }
    liveNames.push({ name, epg });
    const radio = rng.chance(0.01);
    const archiveDays = rng.chance(0.1) ? rng.int(1, 7) : 0;
    const catchup = archiveDays > 0 ? CATCHUP[i % CATCHUP.length]! : null;
    const added = rng.int(0, 900);
    const item: Record<string, unknown> = { id, num: i + 1, name, category: cat.id, added_days_ago: added };
    if (epg) item['epg_id'] = epg;
    if (archiveDays) Object.assign(item, { archive_days: archiveDays, catchup });
    if (radio) item['radio'] = true;
    if (cat.adult) item['adult'] = true;
    await catalog.text(`${i ? ',\n' : ''}${JSON.stringify(item)}`);
    await xLive.text(
      `${i ? ',' : ''}${JSON.stringify({
        num: i + 1, name, stream_type: radio ? 'radio_streams' : 'live', stream_id: id, stream_icon: `${base}/images/channel-${id}.png`,
        epg_channel_id: epg, added: String(ANCHOR_SEC - added * 86_400), is_adult: cat.adult ? '1' : '0', category_id: String(cat.id),
        category_ids: [cat.id], custom_sid: '', tv_archive: archiveDays > 0 ? 1 : 0, direct_source: '', tv_archive_duration: archiveDays,
      })}`,
    );
    const catchupAttrs = catchup ? ` catchup="${catchup}" catchup-days="${archiveDays}"` : '';
    await entry(
      `#EXTINF:-1 tvg-id="${epg ?? ''}" tvg-name="${esc(name)}" tvg-logo="${base}/images/channel-${id}.png" tvg-chno="${i + 1}" group-title="${esc(cat.name)}"${radio ? ' radio="true"' : ''}${catchupAttrs},${name}`,
      `${base}/live/${auth}/${id}.ts`,
    );
    result.live++;
  }
  await xLive.text(']');

  // ---- Movies -------------------------------------------------------------------------------
  await catalog.text('],\n"movies":[\n');
  await xVod.text('[');
  const movieNames: string[] = [];
  for (let i = 0; i < counts.movies; i++) {
    const id = MOVIE_BASE + i + 1;
    const cat = rng.pick(vodCats);
    let name: string;
    if (i > 0 && rng.chance(0.02)) {
      name = movieNames[rng.int(0, i - 1)]!;
      result.duplicateNames++;
    } else {
      name = title(rng, cat.lang, rng.int(1, 3));
      if (rng.chance(0.4)) name += ` (${rng.int(1950, 2026)})`;
    }
    movieNames.push(name);
    const ext = rng.pick(EXTS);
    const year = rng.int(1950, 2026);
    const rating = rng.int(10, 95) / 10;
    const added = rng.int(0, 900);
    const duration = rng.int(4800, 9000);
    const genre = rng.pick(GENRES[cat.lang]);
    await catalog.text(
      `${i ? ',\n' : ''}${JSON.stringify({ id, num: i + 1, name, category: cat.id, ext, year, duration_secs: duration, rating, genre, plot: `${name}.`, added_days_ago: added })}`,
    );
    await xVod.text(
      `${i ? ',' : ''}${JSON.stringify({
        num: i + 1, name, title: name, year: String(year), stream_type: 'movie', stream_id: id, stream_icon: `${base}/images/movie-${id}.png`,
        rating: String(rating), rating_5based: Math.round((rating / 2) * 10) / 10, added: String(ANCHOR_SEC - added * 86_400), is_adult: '0',
        category_id: String(cat.id), category_ids: [cat.id], container_extension: ext, custom_sid: '', direct_source: '',
      })}`,
    );
    await entry(
      `#EXTINF:-1 tvg-id="" tvg-name="${esc(name)}" tvg-logo="${base}/images/movie-${id}.png" group-title="${esc(cat.name)}",${name}`,
      `${base}/movie/${auth}/${id}.${ext}`,
    );
    result.movies++;
  }
  await xVod.text(']');

  // ---- Series and episodes ------------------------------------------------------------------
  await catalog.text('],\n"series":[\n');
  await xSeries.text('[');
  let episodeId = EPISODE_BASE;
  for (let s = 0; s < counts.series; s++) {
    const id = SERIES_BASE + s + 1;
    const cat = rng.pick(seriesCats);
    const name = title(rng, cat.lang, rng.int(1, 3));
    const seasons = (s % 4) + 1;
    const year = rng.int(1990, 2026);
    const rating = rng.int(10, 95) / 10;
    const added = rng.int(0, 900);
    const genre = rng.pick(GENRES[cat.lang]);
    const seasonList: unknown[] = [];
    for (let season = 1; season <= seasons; season++) {
      // Spread episodesPerSeries over the seasons; earlier seasons take the remainder.
      const n = Math.floor(counts.episodesPerSeries / seasons) + (season <= counts.episodesPerSeries % seasons ? 1 : 0);
      const episodes: unknown[] = [];
      for (let e = 1; e <= n; e++) {
        const epId = ++episodeId;
        const ext = rng.pick(EXTS);
        const epTitle = `${name} S${String(season).padStart(2, '0')}E${String(e).padStart(2, '0')} ${EPISODE_WORD[cat.lang]} ${cat.lang === 'ar' ? arabicDigits(e) : e}`;
        episodes.push({ id: epId, episode_num: e, title: epTitle, ext, duration_secs: rng.int(1200, 3600) });
        await entry(
          `#EXTINF:-1 tvg-id="" tvg-name="${esc(epTitle)}" tvg-logo="${base}/images/series-${id}.png" group-title="${esc(cat.name)}",${epTitle}`,
          `${base}/series/${auth}/${epId}.${ext}`,
        );
        result.episodes++;
      }
      seasonList.push({ number: season, episodes });
    }
    await catalog.text(
      `${s ? ',\n' : ''}${JSON.stringify({ id, num: s + 1, name, category: cat.id, year, rating, genre, plot: `${name}.`, added_days_ago: added, seasons: seasonList })}`,
    );
    await xSeries.text(
      `${s ? ',' : ''}${JSON.stringify({
        num: s + 1, name, series_id: id, cover: `${base}/images/series-${id}.png`, plot: `${name}.`, cast: '', director: '', genre,
        releaseDate: `${year}-01-01`, last_modified: String(ANCHOR_SEC - added * 86_400), rating: String(rating),
        rating_5based: Math.round((rating / 2) * 10) / 10, backdrop_path: [], youtube_trailer: '', episode_run_time: '40',
        category_id: String(cat.id), category_ids: [cat.id],
      })}`,
    );
    result.series++;
  }
  await xSeries.text(']');
  await catalog.text(']}\n');

  const files = await Promise.all([
    m3u.close(),
    catalog.close(),
    xLive.close(),
    xVod.close(),
    xSeries.close(),
    writeSmall('live_categories', liveCats),
    writeSmall('vod_categories', vodCats),
    writeSmall('series_categories', seriesCats),
  ]);
  return { files, counts: result };
}
