/**
 * Streaming XMLTV tokenizer (architecture.md §1.5 steps 3 and 9). Not DOMParser: guides are
 * 50-300 MB, so this reads text chunks with a small carry-over buffer and hands back channels
 * and programmes as each one completes.
 *
 * - Entities (`&amp;`, `&#233;`, `&#x1F600;`) and CDATA are decoded; comments, the XML
 *   declaration and DOCTYPE are skipped.
 * - With several titles (or descriptions, display names…) in different languages, the one in
 *   the earliest of `languages` wins; otherwise the first one.
 * - `wantChannel` is asked at each `<programme>` start tag; unwanted programmes (usually over
 *   90% of a big guide) are skipped by searching for `</programme`, without tokenizing them.
 * - Channels are expected before programmes (the standard); a channel after the first programme
 *   is still returned and counted in `stats.lateChannels`.
 * - Times stay as written; `parseXmltvTime` converts them.
 *
 * It never throws, and it gives the same output however the text is chunked.
 */

import { MAX_TEXT } from './model';
import { collapseSpace, cutText } from './text';
import type { ZoneOffset } from './timezone';

export interface XmltvChannel {
  type: 'channel';
  id: string;
  /** The display name for the UI languages. */
  name: string;
  /** Every display name (deduplicated, at most 8), for EPG matching. */
  names: string[];
  icon: string | null;
}

export interface XmltvProgramme {
  type: 'programme';
  channel: string;
  /** `start` as written, e.g. `20261102120000 +0300` (see `parseXmltvTime`). */
  start: string;
  stop: string | null;
  title: string;
  subTitle: string | null;
  desc: string | null;
  category: string | null;
  /** `episode-num` "onscreen", else "xmltv_ns" written as `S1 E5`. */
  episode: string | null;
  icon: string | null;
}

export type XmltvItem = XmltvChannel | XmltvProgramme;

export interface XmltvOptions {
  /** UI languages, most preferred first (`['ar', 'en']`); matched on the primary subtag. */
  languages?: string[];
  /** Asked with each programme's `channel` attribute; `false` skips the programme. */
  wantChannel?: (id: string) => boolean;
  /** Longest description kept (default 1000; 300 on low-tier TVs). */
  descLimit?: number;
  /**
   * Receives each channel and programme as it completes, in document order, instead of the
   * lists `push` and `end` return (which are then empty). A channel reaches it before the
   * `wantChannel` call of any programme after it in the same chunk.
   */
  onItem?: (item: XmltvItem) => void;
}

export interface XmltvStats {
  channels: number;
  programmes: number;
  /** Programmes skipped because `wantChannel` said no. */
  filtered: number;
  /** Programmes without `channel` or `start`, channels without `id`. */
  invalid: number;
  /** Channels after the first programme (an interleaved guide). */
  lateChannels: number;
  /** Texts cut at their length limit. */
  cutTexts: number;
  /** Broken markup recovered from (an unclosed quote, a misplaced element, an overlong buffer). */
  malformed: number;
  /** The input ended inside an element or a tag. */
  truncated: boolean;
}

const NONE = 0;
const CHANNEL = 1;
const PROGRAMME = 2;

const F_NONE = 0;
const F_DISPLAY = 1;
const F_TITLE = 2;
const F_SUB = 3;
const F_DESC = 4;
const F_CATEGORY = 5;
const F_EPISODE = 6;

const PROGRAMME_FIELDS: Record<string, number> = {
  title: F_TITLE,
  'sub-title': F_SUB,
  desc: F_DESC,
  category: F_CATEGORY,
  'episode-num': F_EPISODE,
};
const MAX_NAMES = 8;
/** Longest start tag searched for its closing `>` quote-aware; longer ones are broken. */
const MAX_TAG = 4096;
/** Most text carried over between chunks; beyond it, text is flushed or dropped. */
const MAX_PENDING = 1 << 20;
const END_PROGRAMME = '</programme';

const NAMED_ENTITIES = new Map<string, string>([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', String.fromCharCode(0xa0)],
]);
const REPLACEMENT = String.fromCharCode(0xfffd);

/** Decodes the five XML entities, `&nbsp;` and numeric references; unknown names stay as written. */
export function decodeXmlEntities(text: string): string {
  if (text.indexOf('&') === -1) return text;
  return text.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g, (whole, body: string) => {
    if (body.charCodeAt(0) === 35) {
      const hex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
      const cp = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!(cp > 0 && cp <= 0x10ffff) || (cp >= 0xd800 && cp <= 0xdfff)) return REPLACEMENT;
      return String.fromCodePoint(cp);
    }
    return NAMED_ENTITIES.get(body) ?? whole;
  });
}

const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+))/g;

/** Attributes of a start tag (between its name and `>`), entity-decoded; first value wins. */
function parseAttrs(text: string): Map<string, string> {
  const out = new Map<string, string>();
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(text)) !== null) {
    const name = m[1]!;
    if (!out.has(name)) out.set(name, decodeXmlEntities(m[2] ?? m[3] ?? m[4] ?? ''));
  }
  return out;
}

/**
 * Index of the `>` that ends the tag starting before `from`, skipping quoted attribute values;
 * -1 when it isn't in `s` yet. A tag with an unbalanced quote ends at the first `>` once
 * `MAX_TAG` characters have arrived without a quote-aware end.
 */
function tagEnd(s: string, from: number, final: boolean): { end: number; broken: boolean } {
  const limit = Math.min(s.length, from + MAX_TAG);
  let quote = 0;
  for (let j = from; j < limit; j++) {
    const c = s.charCodeAt(j);
    if (quote !== 0) {
      if (c === quote) quote = 0;
    } else if (c === 34 || c === 39) {
      quote = c;
    } else if (c === 62) {
      return { end: j, broken: false };
    }
  }
  if (limit - from >= MAX_TAG || final) return { end: s.indexOf('>', from), broken: true };
  return { end: -1, broken: false };
}

/** `0.4.0/1` (zero-based season.episode.part) → `S1 E5`; `null` when unreadable. */
function xmltvNsEpisode(text: string): string | null {
  const parts = text.split('.');
  const num = (part: string | undefined): number | null => {
    const m = /^\s*(\d+)/.exec(part ?? '');
    return m ? Number(m[1]) : null;
  };
  const season = num(parts[0]);
  const episode = num(parts[1]);
  if (episode === null) return season === null ? null : `S${season + 1}`;
  return season === null ? `E${episode + 1}` : `S${season + 1} E${episode + 1}`;
}

/** A text candidate chosen by language rank (lower is better; the first wins a tie). */
interface Ranked {
  text: string | null;
  rank: number;
}

function offer(slot: Ranked, text: string, rank: number): void {
  if (text.length > 0 && (slot.text === null || rank < slot.rank)) {
    slot.text = text;
    slot.rank = rank;
  }
}

const fresh = (): Ranked => ({ text: null, rank: 0 });

/** Streams one XMLTV document into channels and programmes. One instance per guide. */
export class XmltvTokenizer {
  readonly stats: XmltvStats = {
    channels: 0,
    programmes: 0,
    filtered: 0,
    invalid: 0,
    lateChannels: 0,
    cutTexts: 0,
    malformed: 0,
    truncated: false,
  };

  private readonly languages: string[];
  private readonly wantChannel: ((id: string) => boolean) | null;
  private readonly descLimit: number;
  private readonly onItem: ((item: XmltvItem) => void) | null;
  private readonly ranks = new Map<string, number>();

  private buf = '';
  private ctx = NONE;
  private skipping = false;
  private sawProgramme = false;

  // The element being read.
  private id = '';
  private names: string[] = [];
  private name = fresh();
  private icon: string | null = null;
  private start = '';
  private stop: string | null = null;
  private title = fresh();
  private subTitle = fresh();
  private desc = fresh();
  private category = fresh();
  private onscreen: string | null = null;
  private xmltvNs: string | null = null;

  // The text field being captured.
  private field = F_NONE;
  private fieldTag = '';
  private fieldRank = 0;
  private fieldSystem = '';
  private fieldText = '';
  private fieldLimit = 0;

  constructor(options: XmltvOptions = {}) {
    this.languages = (options.languages ?? []).map((l) => primaryLanguage(l));
    this.wantChannel = options.wantChannel ?? null;
    this.descLimit = Math.max(0, options.descLimit ?? 1000);
    this.onItem = options.onItem ?? null;
  }

  /** Feeds the next chunk of text; returns the channels and programmes it completed, in order. */
  push(chunk: string): XmltvItem[] {
    this.buf = this.buf.length > 0 ? this.buf + chunk : chunk;
    return this.scan(false);
  }

  /** Ends the input. An element or tag still open is dropped and `truncated` is set. */
  end(): XmltvItem[] {
    const out = this.scan(true);
    if (this.ctx !== NONE || this.skipping || this.buf.length > 0) this.stats.truncated = true;
    this.buf = '';
    this.ctx = NONE;
    this.skipping = false;
    this.field = F_NONE;
    return out;
  }

  private scan(final: boolean): XmltvItem[] {
    const out: XmltvItem[] = [];
    const s = this.buf;
    const n = s.length;
    let i = 0;
    while (i < n) {
      if (this.skipping) {
        const j = s.indexOf(END_PROGRAMME, i);
        if (j === -1) {
          // Keep only a tail that may hold the start of "</programme".
          i = Math.max(i, n - END_PROGRAMME.length + 1);
          break;
        }
        const gt = s.indexOf('>', j + END_PROGRAMME.length);
        if (gt === -1) {
          i = j;
          break;
        }
        this.skipping = false;
        i = gt + 1;
        continue;
      }
      const lt = s.indexOf('<', i);
      if (lt === -1) {
        i = this.trailingText(s, i, final);
        break;
      }
      if (lt > i && this.field !== F_NONE) this.appendText(decodeXmlEntities(s.slice(i, lt)));
      if (lt + 1 >= n) {
        i = lt;
        break;
      }
      const c = s.charCodeAt(lt + 1);
      if (c === 33) {
        // <!-- comment -->, <![CDATA[ … ]]>, <!DOCTYPE …>
        if (s.startsWith('<!--', lt)) {
          const end = s.indexOf('-->', lt + 4);
          if (end === -1) {
            i = lt;
            break;
          }
          i = end + 3;
        } else if (s.startsWith('<![CDATA[', lt)) {
          const end = s.indexOf(']]>', lt + 9);
          if (end === -1) {
            i = lt;
            break;
          }
          if (this.field !== F_NONE) this.appendText(s.slice(lt + 9, end));
          i = end + 3;
        } else if (!final && n - lt < 9) {
          i = lt;
          break;
        } else {
          const end = s.indexOf('>', lt + 2);
          if (end === -1) {
            i = lt;
            break;
          }
          i = end + 1;
        }
        continue;
      }
      if (c === 63) {
        // <?xml … ?>
        const end = s.indexOf('?>', lt + 2);
        if (end === -1) {
          i = lt;
          break;
        }
        i = end + 2;
        continue;
      }
      const tag = tagEnd(s, lt + 1, final);
      if (tag.end === -1) {
        i = lt;
        break;
      }
      if (tag.broken) this.stats.malformed++;
      this.tag(s, lt, tag.end, out);
      i = tag.end + 1;
    }
    let rest = i >= n ? '' : s.slice(i);
    if (rest.length > MAX_PENDING) {
      // An unclosed comment, CDATA or tag swallowing the input: drop it and carry on.
      this.stats.malformed++;
      rest = '';
    }
    this.buf = rest;
    return out;
  }

  /** Text after the last `<` of the buffer: kept for the next chunk (it may continue). */
  private trailingText(s: string, i: number, final: boolean): number {
    const n = s.length;
    if (final || n - i > MAX_PENDING) {
      if (this.field === F_NONE) return n;
      // Flush, but keep a possibly unfinished entity (they are at most 16 characters).
      const amp = final ? -1 : s.lastIndexOf('&');
      const cut = amp >= i && n - amp <= 16 ? amp : n;
      this.appendText(decodeXmlEntities(s.slice(i, cut)));
      return cut;
    }
    return i;
  }

  private tag(s: string, lt: number, gt: number, out: XmltvItem[]): void {
    const closing = s.charCodeAt(lt + 1) === 47;
    const from = closing ? lt + 2 : lt + 1;
    let q = from;
    while (q < gt) {
      const c = s.charCodeAt(q);
      if (c <= 32 || c === 47) break;
      q++;
    }
    const name = s.slice(from, q);
    if (closing) {
      this.endElement(name, out);
      return;
    }
    const selfClosing = gt - 1 >= q && s.charCodeAt(gt - 1) === 47;
    this.startElement(name, s, q, selfClosing ? gt - 1 : gt, selfClosing, out);
    if (selfClosing) this.endElement(name, out);
  }

  private startElement(name: string, s: string, from: number, to: number, selfClosing: boolean, out: XmltvItem[]): void {
    if (this.ctx !== NONE && (name === 'programme' || name === 'channel')) {
      // The previous element was never closed: finish it and start over.
      this.stats.malformed++;
      this.endElement(this.ctx === PROGRAMME ? 'programme' : 'channel', out);
    }
    if (this.ctx === NONE) {
      if (name === 'programme') this.startProgramme(parseAttrs(s.slice(from, to)), selfClosing);
      else if (name === 'channel') this.startChannel(parseAttrs(s.slice(from, to)));
      return;
    }
    if (this.field !== F_NONE) return;
    if (this.ctx === CHANNEL) {
      if (name === 'display-name') this.capture(F_DISPLAY, name, parseAttrs(s.slice(from, to)), MAX_TEXT);
      else if (name === 'icon' && this.icon === null) this.icon = nonEmpty(parseAttrs(s.slice(from, to)).get('src'));
      return;
    }
    const field = PROGRAMME_FIELDS[name];
    if (field !== undefined) {
      this.capture(field, name, parseAttrs(s.slice(from, to)), field === F_DESC ? this.descLimit : MAX_TEXT);
    } else if (name === 'icon' && this.icon === null) {
      this.icon = nonEmpty(parseAttrs(s.slice(from, to)).get('src'));
    }
  }

  private startProgramme(attrs: Map<string, string>, selfClosing: boolean): void {
    this.sawProgramme = true;
    const channel = (attrs.get('channel') ?? '').trim();
    const start = (attrs.get('start') ?? '').trim();
    if (channel.length === 0 || start.length === 0) {
      this.stats.invalid++;
      this.skipping = !selfClosing;
      return;
    }
    if (this.wantChannel !== null && !this.wantChannel(channel)) {
      this.stats.filtered++;
      this.skipping = !selfClosing;
      return;
    }
    this.ctx = PROGRAMME;
    this.id = channel;
    this.start = start;
    this.stop = nonEmpty(attrs.get('stop'));
    this.title = fresh();
    this.subTitle = fresh();
    this.desc = fresh();
    this.category = fresh();
    this.onscreen = null;
    this.xmltvNs = null;
    this.icon = null;
  }

  private startChannel(attrs: Map<string, string>): void {
    if (this.sawProgramme) this.stats.lateChannels++;
    this.ctx = CHANNEL;
    this.id = (attrs.get('id') ?? '').trim();
    this.names = [];
    this.name = fresh();
    this.icon = null;
  }

  private capture(field: number, tag: string, attrs: Map<string, string>, limit: number): void {
    this.field = field;
    this.fieldTag = tag;
    this.fieldRank = this.rank(attrs.get('lang'));
    this.fieldSystem = (attrs.get('system') ?? '').toLowerCase();
    this.fieldText = '';
    this.fieldLimit = limit;
  }

  private appendText(text: string): void {
    // Room for entities already decoded and whitespace still to collapse.
    const room = this.fieldLimit * 2 + 64 - this.fieldText.length;
    if (room <= 0) return;
    this.fieldText += text.length > room ? text.slice(0, room) : text;
  }

  private endElement(name: string, out: XmltvItem[]): void {
    if (this.field !== F_NONE) {
      if (name === this.fieldTag) {
        this.finishField();
        return;
      }
      // An unclosed field inside a closing container: finish it, then close the container.
      if (!((name === 'programme' && this.ctx === PROGRAMME) || (name === 'channel' && this.ctx === CHANNEL))) return;
      this.stats.malformed++;
      this.finishField();
    }
    if (this.ctx === PROGRAMME && name === 'programme') {
      this.ctx = NONE;
      this.stats.programmes++;
      this.emit(out, {
        type: 'programme',
        channel: this.id,
        start: this.start,
        stop: this.stop,
        title: this.title.text ?? '',
        subTitle: this.subTitle.text,
        desc: this.desc.text,
        category: this.category.text,
        episode: this.onscreen ?? (this.xmltvNs === null ? null : xmltvNsEpisode(this.xmltvNs)),
        icon: this.icon,
      });
    } else if (this.ctx === CHANNEL && name === 'channel') {
      this.ctx = NONE;
      if (this.id.length === 0) {
        this.stats.invalid++;
        return;
      }
      this.stats.channels++;
      this.emit(out, { type: 'channel', id: this.id, name: this.name.text ?? this.id, names: this.names, icon: this.icon });
    }
  }

  private emit(out: XmltvItem[], item: XmltvItem): void {
    if (this.onItem === null) out.push(item);
    else this.onItem(item);
  }

  private finishField(): void {
    const field = this.field;
    this.field = F_NONE;
    let text = collapseSpace(this.fieldText);
    this.fieldText = '';
    if (text.length > this.fieldLimit) {
      text = cutText(text, this.fieldLimit);
      this.stats.cutTexts++;
    }
    const rank = this.fieldRank;
    switch (field) {
      case F_DISPLAY:
        if (text.length > 0 && this.names.length < MAX_NAMES && this.names.indexOf(text) === -1) this.names.push(text);
        offer(this.name, text, rank);
        break;
      case F_TITLE:
        offer(this.title, text, rank);
        break;
      case F_SUB:
        offer(this.subTitle, text, rank);
        break;
      case F_DESC:
        offer(this.desc, text, rank);
        break;
      case F_CATEGORY:
        offer(this.category, text, rank);
        break;
      case F_EPISODE:
        if (text.length === 0) break;
        if (this.fieldSystem === 'onscreen' && this.onscreen === null) this.onscreen = text;
        else if (this.fieldSystem === 'xmltv_ns' && this.xmltvNs === null) this.xmltvNs = text;
        break;
      default:
        break;
    }
  }

  private rank(lang: string | undefined): number {
    if (this.languages.length === 0) return 0;
    if (lang === undefined) return this.languages.length;
    // A guide uses a handful of lang values: remember each one's rank.
    let rank = this.ranks.get(lang);
    if (rank === undefined) {
      const at = this.languages.indexOf(primaryLanguage(lang));
      rank = at === -1 ? this.languages.length : at;
      if (this.ranks.size < 64) this.ranks.set(ownCopy(lang), rank);
    }
    return rank;
  }
}

/** A flat copy: a cached attribute value must not keep its whole chunk alive. */
function ownCopy(s: string): string {
  return (' ' + s).slice(1);
}

function primaryLanguage(lang: string): string {
  return lang.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

function nonEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

/** Tokenizes a whole text at once (tests, small guides). */
export function parseXmltv(text: string, options: XmltvOptions = {}): { items: XmltvItem[]; stats: XmltvStats } {
  const tokenizer = new XmltvTokenizer(options);
  const items = tokenizer.push(text);
  for (const item of tokenizer.end()) items.push(item);
  return { items, stats: tokenizer.stats };
}

const XMLTV_TIME = /^\s*(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?\s*(.*)$/;

/** Minutes east of UTC a zone suffix states (`+0545`, `+05:45`, `+05`, `Z`…); `null` if none or unreadable. */
function zoneMinutes(zone: string): number | null {
  const offset = /^([+-])(\d{2}):?(\d{2})$/.exec(zone) ?? /^([+-])(\d{1,2})()$/.exec(zone);
  if (offset) {
    const minutes = Number(offset[2]) * 60 + (offset[3] ? Number(offset[3]) : 0);
    return offset[1] === '-' ? -minutes : minutes;
  }
  return /^(?:Z|UTC|GMT)$/i.test(zone) ? 0 : null;
}

/**
 * Whether an XMLTV time states its own offset (so `parseXmltvTime` ignores its fallback zone).
 * The EPG pipeline repairs the repeated DST hour only in times that don't.
 */
export function xmltvTimeHasZone(raw: string): boolean {
  const m = XMLTV_TIME.exec(raw);
  return m !== null && zoneMinutes((m[7] ?? '').trim()) !== null;
}

/**
 * Epoch ms of an XMLTV time (`YYYYMMDDhhmmss ±hhmm`). Accepted offsets: `+0545`, `+05:45`,
 * `+05`, `Z`, `UTC`, `GMT`. Without one (or with one it can't read), `fallback` gives the zone:
 * fixed minutes east of UTC, or an offset function (the source's time offset, or the panel's
 * zone for an Xtream guide). `null` when the date itself is unreadable.
 */
export function parseXmltvTime(raw: string, fallback: number | ZoneOffset = 0): number | null {
  // Fast path for the usual `YYYYMMDDhhmmss +hhmm` (a guide has millions of these); anything
  // else, or anything it can't read, takes the general path, which gives the same answers.
  if (raw.length === 20 && raw.charCodeAt(14) === 32) {
    const sign = raw.charCodeAt(15);
    const year = digits(raw, 0, 4);
    const month = digits(raw, 4, 2);
    const day = digits(raw, 6, 2);
    const hour = digits(raw, 8, 2);
    const minute = digits(raw, 10, 2);
    const second = digits(raw, 12, 2);
    const offH = digits(raw, 16, 2);
    const offM = digits(raw, 18, 2);
    if (
      (sign === 43 || sign === 45) &&
      year >= 0 &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31 &&
      hour >= 0 &&
      hour <= 24 &&
      minute >= 0 &&
      minute <= 59 &&
      second >= 0 &&
      second <= 60 &&
      offH >= 0 &&
      offM >= 0
    ) {
      const offset = (offH * 60 + offM) * (sign === 45 ? -1 : 1);
      return Date.UTC(year, month - 1, day, hour, minute, second) - offset * 60_000;
    }
  }
  return parseXmltvTimeGeneral(raw, fallback);
}

/** The value of `n` ASCII digits at `from`, or -1 if one isn't a digit. */
function digits(s: string, from: number, n: number): number {
  let v = 0;
  for (let i = from; i < from + n; i++) {
    const c = s.charCodeAt(i) - 48;
    if (c < 0 || c > 9) return -1;
    v = v * 10 + c;
  }
  return v;
}

/** @internal `parseXmltvTime` without its fast path (tests compare the two). */
export function parseXmltvTimeGeneral(raw: string, fallback: number | ZoneOffset = 0): number | null {
  const m = XMLTV_TIME.exec(raw);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = m[4] === undefined ? 0 : Number(m[4]);
  const minute = m[5] === undefined ? 0 : Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 24 || minute > 59 || second > 60) return null;
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const stated = zoneMinutes((m[7] ?? '').trim());
  if (stated !== null) return wall - stated * 60_000;
  if (typeof fallback === 'number') return wall - fallback * 60_000;
  // Wall time in a zone with DST: settle the offset in two steps.
  const first = wall - fallback(wall) * 60_000;
  return wall - fallback(first) * 60_000;
}
