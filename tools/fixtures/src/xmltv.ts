// Scale XMLTV (architecture.md §4): 14 days of programmes, sized to about 50, 150 and 300 MB,
// each with a .gz copy. The 300 MB file has 5k channels (every EPG id the scale catalog uses);
// the smaller ones have fewer channels. Programmes have entities, CDATA, multi-language titles,
// several zone offsets and odd slot lengths, so the streaming tokenizer gets real-world input.

import { join } from 'node:path';
import { EPG_CHANNELS, epgId } from './catalog';
import type { Lang } from './catalog';
import { Rng } from './prng';
import type { WrittenFile } from './writer';
import { FixtureWriter } from './writer';

export interface XmltvSpec {
  name: string;
  channels: number;
  /** Target size; description lengths are tuned to land within a few percent of it. */
  targetBytes: number;
}

export const XMLTV_SPECS: readonly XmltvSpec[] = [
  { name: 'xmltv-50mb.xml', channels: 850, targetBytes: 50e6 },
  { name: 'xmltv-150mb.xml', channels: 2_500, targetBytes: 150e6 },
  { name: 'xmltv-300mb.xml', channels: EPG_CHANNELS, targetBytes: 300e6 },
];

export const XMLTV_DAYS = 14;
/** The guide covers [anchor - 7 days, anchor + 7 days). */
export const XMLTV_ANCHOR_MS = Date.UTC(2026, 10, 1);
/** Minutes per programme by channel: about 19 programmes a day on average. */
const SLOTS = [30, 60, 60, 90, 120, 120, 150, 180];
const OFFSETS = [0, 0, 0, 180, 240, 60, -300, -480, 330];

const TITLES: Record<Lang, string[]> = {
  en: ['Evening News', 'Match Day', 'Late Movie', 'Cartoon Hour', 'Top Tracks', 'Wild Planet', 'The Family', 'Stand-Up Live', 'Weather Watch', 'Market Close'],
  ar: ['نشرة المساء', 'يوم المباراة', 'فيلم السهرة', 'ساعة الكرتون', 'أفضل الأغاني', 'كوكب بري', 'العائلة', 'كوميديا مباشرة', 'حالة الطقس', 'إغلاق السوق'],
  fr: ['Journal du Soir', 'Jour de Match', 'Film de Minuit', 'Heure des Dessins', 'Top Musique', 'Planète Sauvage', 'La Famille', 'Humour en Direct', 'Météo', 'Clôture'],
  es: ['Noticias de la Noche', 'Día de Partido', 'Película', 'Hora de Dibujos', 'Éxitos', 'Planeta Salvaje', 'La Familia', 'Comedia en Vivo', 'El Tiempo', 'Cierre'],
};
const LANGS: Lang[] = ['en', 'ar', 'fr', 'es'];
const FILLER: Record<Lang, string> = {
  en: 'A test programme for Zoma scale fixtures with invented content & no real shows. ',
  ar: 'برنامج تجريبي لاختبارات زوما على نطاق واسع بمحتوى مُختلق وبدون عروض حقيقية. ',
  fr: 'Une émission de test pour les fixtures de Zoma, contenu inventé et aucune vraie émission. ',
  es: 'Un programa de prueba para los fixtures de Zoma, con contenido inventado y sin programas reales. ',
};

function xmltvTime(ms: number, offsetMin: number): string {
  const d = new Date(ms + offsetMin * 60_000);
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}00 ${sign}${p(Math.floor(abs / 60))}${p(abs % 60)}`;
}

/** Programme length of channel `k`, in minutes (every programme of a channel has the same). */
export const slotOf = (k: number): number => SLOTS[k % SLOTS.length]!;

/** Programmes of channel `k`: back to back from `XMLTV_ANCHOR_MS - 7 days`, `slotOf(k)` apart. */
export const channelProgrammes = (k: number): number => Math.ceil((XMLTV_DAYS * 24 * 60) / slotOf(k));

/** Programmes the spec will contain (deterministic), for sizing and for tests. */
export function programmeCount(spec: XmltvSpec): number {
  let n = 0;
  for (let k = 0; k < spec.channels; k++) n += channelProgrammes(k);
  return n;
}

/**
 * Average bytes of a programme element without its description text (measured on the
 * generated files; the size test keeps it honest).
 */
export const PROGRAMME_OVERHEAD = 196;
/** Share of programmes that have a description. */
const DESC_SHARE = 0.7;

export interface XmltvResult {
  file: WrittenFile;
  channels: number;
  programmes: number;
}

export async function writeXmltv(outDir: string, spec: XmltvSpec, seed: number): Promise<XmltvResult> {
  const rng = Rng.derive(seed, spec.name);
  const programmes = programmeCount(spec);
  // Mean description length that lands the file near its target (UTF-8 bytes ~ chars here,
  // Arabic counted at 2 bytes, averaged over the four languages).
  const descBytes = Math.max(0, Math.floor((spec.targetBytes / programmes - PROGRAMME_OVERHEAD - (spec.channels * 200) / programmes) / DESC_SHARE));
  const w = new FixtureWriter(join(outDir, spec.name), true);
  await w.text('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE tv SYSTEM "xmltv.dtd">\n<tv generator-info-name="Zoma scale fixtures" source-info-name="zoma.test">\n');
  const langOf = (k: number): Lang => LANGS[k % LANGS.length]!;
  for (let k = 0; k < spec.channels; k++) {
    const lang = langOf(k);
    await w.text(
      `  <channel id="${epgId(k)}">\n    <display-name lang="${lang}">${TITLES[lang][k % 10]} ${k}</display-name>\n    <display-name>CH ${k}</display-name>\n    <icon src="http://127.0.0.1:8080/images/channel-${k}.png" />\n  </channel>\n`,
    );
  }
  const from = XMLTV_ANCHOR_MS - 7 * 86_400_000;
  const to = from + XMLTV_DAYS * 86_400_000;
  let count = 0;
  for (let k = 0; k < spec.channels; k++) {
    const id = epgId(k);
    const lang = langOf(k);
    const slotMs = slotOf(k) * 60_000;
    const offset = OFFSETS[k % OFFSETS.length]!;
    const filler = FILLER[lang];
    const perChar = lang === 'ar' ? 1.8 : 1.02;
    for (let start = from; start < to; start += slotMs) {
      const t = rng.pick(TITLES[lang]);
      const episode = rng.int(1, 999);
      let extra = '';
      if (rng.chance(DESC_SHARE)) {
        const len = Math.max(1, Math.round((descBytes * (0.5 + rng.float())) / perChar));
        let desc = filler.repeat(Math.ceil(len / filler.length) + 1).slice(0, len).replace(/&/g, '&amp;');
        if (rng.chance(0.01)) desc = `<![CDATA[${desc.replace(/&amp;/g, '&')} <b>bold</b>]]>`;
        extra += `<desc lang="${lang}">${desc}</desc>`;
      }
      if (lang !== 'en' && rng.chance(0.2)) extra += `<title lang="en">${TITLES.en[k % 10]} ${episode}</title>`;
      if (rng.chance(0.3)) extra += '<category lang="en">Test</category>';
      if (rng.chance(0.1)) extra += `<sub-title lang="${lang}">&quot;${episode}&quot; &amp; more</sub-title><episode-num system="onscreen">E${episode}</episode-num>`;
      await w.text(
        `<programme start="${xmltvTime(start, offset)}" stop="${xmltvTime(start + slotMs, offset)}" channel="${id}"><title lang="${lang}">${t} ${episode}</title>${extra}</programme>\n`,
      );
      count++;
    }
  }
  await w.text('</tv>\n');
  return { file: await w.close(), channels: spec.channels, programmes: count };
}
