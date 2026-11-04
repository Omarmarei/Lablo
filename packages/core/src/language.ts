/**
 * Language codes as streams and playlists write them, folded to one form (architecture.md §2
 * "Tracks", RELAY step 20b): the player matches audio and subtitle tracks against the user's
 * preferred languages (`['ar', 'en']`) and remembers a channel's choice by language.
 *
 * `normalizeLang`:
 * - the primary subtag of a BCP 47 tag or locale (`ar-SA`, `en_GB`, `zh-Hant` → `ar`, `en`, `zh`);
 * - ISO 639-1 codes as they are (`fr` → `fr`), ISO 639-2/T and /B codes (`ara`, `fre`, `ger`) and
 *   the individual Arabic and Chinese languages (`arb`, `arz`, `apc`, `cmn`, `yue`) to their
 *   639-1 code where one exists; other three-letter codes as they are (`kur` stays `kur`);
 * - English and native names (`Arabic`, `عربي`, `العربية`, `Français`, `Deutsch`) to the code;
 * - `''` for nothing, "undetermined" (`und`, `unk`, `mis`, `mul`, `zxx`, `qaa`–`qtz`), and names it
 *   doesn't know.
 *
 * The result is always `''` or two or three lower-case ASCII letters, and normalizing it again
 * gives it back. Pure and ES2017 (it runs in the TV's main bundle): no `RegExp` constructor and
 * no `split`.
 */

/** Three-letter codes (639-2/T, 639-2/B, individual languages) to their 639-1 code. */
const THREE: Readonly<Record<string, string>> = {
  // Arabic, its macrolanguage members and the dialects streams name.
  ara: 'ar', arb: 'ar', arz: 'ar', apc: 'ar', ajp: 'ar', acm: 'ar', afb: 'ar', ars: 'ar', ary: 'ar', arq: 'ar',
  aeb: 'ar', ayl: 'ar', apd: 'ar', acw: 'ar', acx: 'ar', ayh: 'ar', ayn: 'ar', abv: 'ar', adf: 'ar', aec: 'ar',
  auz: 'ar', ayp: 'ar', shu: 'ar', ssh: 'ar', abh: 'ar', acq: 'ar', pga: 'ar', acy: 'ar', avl: 'ar', aao: 'ar',
  eng: 'en', fra: 'fr', fre: 'fr', spa: 'es', deu: 'de', ger: 'de', ita: 'it', por: 'pt', rus: 'ru', tur: 'tr',
  fas: 'fa', per: 'fa', pes: 'fa', prs: 'fa', urd: 'ur', hin: 'hi', zho: 'zh', chi: 'zh', cmn: 'zh', yue: 'zh',
  jpn: 'ja', kor: 'ko', nld: 'nl', dut: 'nl', ben: 'bn', tam: 'ta', tel: 'te', mal: 'ml', pan: 'pa', guj: 'gu',
  mar: 'mr', kan: 'kn', tgl: 'tl', fil: 'tl', ind: 'id', msa: 'ms', may: 'ms', zsm: 'ms', tha: 'th', vie: 'vi',
  pol: 'pl', ukr: 'uk', heb: 'he', swe: 'sv', nor: 'no', nob: 'nb', nno: 'nn', dan: 'da', fin: 'fi', hun: 'hu',
  ces: 'cs', cze: 'cs', ell: 'el', gre: 'el', ron: 'ro', rum: 'ro', bul: 'bg', hrv: 'hr', srp: 'sr', slv: 'sl',
  slk: 'sk', slo: 'sk', sqi: 'sq', alb: 'sq', hye: 'hy', arm: 'hy', kat: 'ka', geo: 'ka', aze: 'az', kaz: 'kk',
  uzb: 'uz', kur: 'ku', ckb: 'ku', kmr: 'ku', pus: 'ps', pbt: 'ps', som: 'so', amh: 'am', swa: 'sw', swh: 'sw',
  hau: 'ha', nep: 'ne', npi: 'ne', sin: 'si', mya: 'my', bur: 'my', khm: 'km', lao: 'lo', mon: 'mn', tgk: 'tg',
  tuk: 'tk', kir: 'ky', bos: 'bs', mkd: 'mk', mac: 'mk', lit: 'lt', lav: 'lv', est: 'et', isl: 'is', ice: 'is',
  gle: 'ga', cym: 'cy', wel: 'cy', eus: 'eu', baq: 'eu', cat: 'ca', glg: 'gl', afr: 'af', yid: 'yi', bod: 'bo',
  tib: 'bo', mri: 'mi', mao: 'mi', ori: 'or', asm: 'as', snd: 'sd', div: 'dv', tir: 'ti', orm: 'om', yor: 'yo',
  ibo: 'ig', zul: 'zu', xho: 'xh', mlt: 'mt', bel: 'be', ltz: 'lb', epo: 'eo', lat: 'la',
};

/** Codes that say no language: undetermined, unknown, several, none. */
const NONE: readonly string[] = ['und', 'unk', 'mis', 'mul', 'zxx', 'xx', 'xxx', 'non', 'none', 'nil'];

/** Two-letter codes that were renamed. */
const OLD_TWO: Readonly<Record<string, string>> = { iw: 'he', in: 'id', ji: 'yi', mo: 'ro' };

/** Language names (lower-case, as the stream or playlist writes them) to the code. */
const NAMES: Readonly<Record<string, string>> = {
  arabic: 'ar', arabe: 'ar', 'árabe': 'ar', arabisch: 'ar', arab: 'ar',
  'عربي': 'ar', 'عربى': 'ar', 'عربية': 'ar', 'عربيه': 'ar', 'العربية': 'ar', 'العربيه': 'ar', 'العربي': 'ar',
  english: 'en', anglais: 'en', 'inglés': 'en', ingles: 'en', englisch: 'en',
  'انجليزي': 'en', 'إنجليزي': 'en', 'انكليزي': 'en', 'إنكليزي': 'en', 'الانجليزية': 'en', 'الإنجليزية': 'en',
  'الانكليزية': 'en', 'الإنكليزية': 'en', 'انجليزية': 'en', 'إنجليزية': 'en',
  french: 'fr', 'français': 'fr', francais: 'fr', 'francés': 'fr', 'فرنسي': 'fr', 'الفرنسية': 'fr', 'فرنسية': 'fr',
  spanish: 'es', 'español': 'es', espanol: 'es', castellano: 'es', 'إسباني': 'es', 'الإسبانية': 'es', 'الاسبانية': 'es',
  german: 'de', deutsch: 'de', allemand: 'de', 'ألماني': 'de', 'الألمانية': 'de', 'الالمانية': 'de',
  italian: 'it', italiano: 'it', 'إيطالي': 'it', 'الإيطالية': 'it',
  portuguese: 'pt', 'português': 'pt', portugues: 'pt', 'البرتغالية': 'pt',
  russian: 'ru', 'русский': 'ru', 'روسي': 'ru', 'الروسية': 'ru',
  turkish: 'tr', 'türkçe': 'tr', turkce: 'tr', 'تركي': 'tr', 'التركية': 'tr',
  persian: 'fa', farsi: 'fa', 'فارسی': 'fa', 'فارسي': 'fa', 'الفارسية': 'fa',
  urdu: 'ur', 'اردو': 'ur', 'أردو': 'ur', 'الأردية': 'ur', 'الاردية': 'ur',
  hindi: 'hi', 'हिन्दी': 'hi', 'हिंदी': 'hi', 'الهندية': 'hi', 'هندي': 'hi',
  chinese: 'zh', mandarin: 'zh', cantonese: 'zh', '中文': 'zh', 'الصينية': 'zh',
  japanese: 'ja', '日本語': 'ja', 'اليابانية': 'ja',
  korean: 'ko', '한국어': 'ko', 'الكورية': 'ko',
  dutch: 'nl', nederlands: 'nl',
  bengali: 'bn', bangla: 'bn', tamil: 'ta', telugu: 'te', malayalam: 'ml', punjabi: 'pa', gujarati: 'gu',
  marathi: 'mr', kannada: 'kn', tagalog: 'tl', filipino: 'tl', indonesian: 'id', malay: 'ms', thai: 'th',
  vietnamese: 'vi', polish: 'pl', ukrainian: 'uk', hebrew: 'he', swedish: 'sv', norwegian: 'no', danish: 'da',
  finnish: 'fi', hungarian: 'hu', czech: 'cs', greek: 'el', romanian: 'ro', bulgarian: 'bg', croatian: 'hr',
  serbian: 'sr', kurdish: 'ku', pashto: 'ps', somali: 'so', amharic: 'am', swahili: 'sw', nepali: 'ne',
  albanian: 'sq', armenian: 'hy', azerbaijani: 'az', 'كردي': 'ku', 'الكردية': 'ku',
};

const own = (table: Readonly<Record<string, string>>, key: string): string | undefined =>
  Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;

/**
 * `c` ends the language part: ASCII that isn't a letter (`-`, `_`, space, digits, brackets…), the
 * no-break space, the Arabic comma, General Punctuation (spaces, dashes, zero-width and bidi
 * controls), the ideographic space, fullwidth brackets and the BOM.
 */
function ends(c: number): boolean {
  if (c < 128) return !((c >= 65 && c <= 90) || (c >= 97 && c <= 122));
  return c === 0xa0 || c === 0x60c || (c >= 0x2000 && c <= 0x206f) || c === 0x3000 || c === 0xff08 || c === 0xff09 || c === 0xfeff;
}

function isAsciiLower(word: string): boolean {
  for (let i = 0; i < word.length; i++) {
    const c = word.charCodeAt(i);
    if (c < 97 || c > 122) return false;
  }
  return true;
}

/** The language a stream's or playlist's language text names (see the module comment). */
export function normalizeLang(text: string): string {
  let start = 0;
  while (start < text.length && ends(text.charCodeAt(start))) start++;
  let end = start;
  while (end < text.length && !ends(text.charCodeAt(end))) end++;
  const word = text.slice(start, end).toLowerCase();
  if (word === '' || NONE.indexOf(word) !== -1) return '';
  if (isAsciiLower(word)) {
    if (word.length === 2) return own(OLD_TWO, word) ?? word;
    if (word.length === 3) {
      // 639-2 keeps qaa–qtz for local use: no language anyone can prefer.
      if (word >= 'qaa' && word <= 'qtz') return '';
      return own(THREE, word) ?? word;
    }
  }
  return own(NAMES, word) ?? '';
}
