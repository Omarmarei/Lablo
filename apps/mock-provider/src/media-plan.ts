// The legal media set as data: which ffmpeg jobs produce the test channels and VOD files for a
// catalog (RELAY step 4, architecture.md §4 "Mock provider → Media"). Pure functions only, so
// the argument lists are unit-tested without ffmpeg; media-gen.ts runs them.
//
// Live channels are 60 s loops of 6 s MPEG-TS segments (ts-rewrite.ts places them on the epoch
// timeline). The burned-in "sec SS.ff" is the loop position, which equals the UTC second of
// the minute once the loop is placed on the timeline. VOD files are encoded at full length up
// to 5 minutes, and longer files (the open-movie stand-ins) loop a short clip.

import { createHash } from 'node:crypto';
import type { Catalog, Episode, FileMediaProfile, LiveChannel, LiveMediaProfile, Movie, OpenMovieKey } from './config';

/** Bump to regenerate every asset (part of each asset's cache hash). */
export const MEDIA_GENERATOR_VERSION = 1;
export const SEGMENT_SECONDS = 6;
export const LIVE_LOOP_SECONDS = 60;
/** Files up to this long are encoded in full; longer ones loop a shorter clip. */
const FULL_ENCODE_MAX_SECONDS = 300;
const STAND_IN_CLIP_SECONDS = 6;
const GENERIC_FILE_SECONDS = 60;
const AUDIO_RATE = 48_000;

export type VideoSource = 'testsrc2' | 'smptehdbars';

export interface VideoSpec {
  source: VideoSource;
  width: number;
  height: number;
  fps: number;
  codec: 'h264' | 'hevc';
  /** kbit/s */
  bitrate: number;
}

export interface AudioSpec {
  /** ISO 639-2 code written to the stream metadata. */
  lang: string;
  title: string;
  /** mp3 only for audio-only loops: 1152-sample frames make 6 s exactly 250 frames at 48 kHz. */
  codec: 'aac' | 'ac3' | 'eac3' | 'mp3';
  channels: 2 | 6;
  /** Tone frequency (Hz); stereo tracks beep at 4x once a second for lip-sync checks. */
  freq: number;
}

export interface SubtitleSpec {
  lang: 'ara' | 'eng';
  title: string;
}

export interface LiveAsset {
  kind: 'live';
  /** Catalog channel id, or `generic` for channels without their own loop (scale catalogs). */
  key: string;
  label: string[];
  video: VideoSpec | null;
  audio: AudioSpec[];
}

export interface FileAsset {
  kind: 'file';
  /** `movie:201`, `episode:3001`, or `generic:mp4`. */
  key: string;
  ext: 'mp4' | 'mkv';
  durationSecs: number;
  /** Seconds actually encoded; the rest loops it (equal to durationSecs when encoded in full). */
  clipSecs: number;
  label: string[];
  video: VideoSpec;
  audio: AudioSpec[];
  subtitles: SubtitleSpec[];
  /** Set for an open-movie stand-in, which `pnpm mock:open-movies` replaces with the film. */
  openMovie?: OpenMovieKey;
}

export type MediaAsset = LiveAsset | FileAsset;

/** Containers we generate; other extensions fall back to placeholder bytes. */
export const GENERATED_EXTS = ['mp4', 'mkv'] as const;

const stereo = (lang: string, title: string, freq: number): AudioSpec => ({ lang, title, codec: 'aac', channels: 2, freq });

function video(source: VideoSource, width: number, height: number, fps: number, bitrate: number, codec: VideoSpec['codec'] = 'h264'): VideoSpec {
  return { source, width, height, fps, codec, bitrate };
}

/** The name when it is plain ASCII (drawtext has no shaping for Arabic), else the fallback. */
export function asciiLabel(name: string, fallback: string): string {
  return /^[\x20-\x7e]+$/.test(name) ? name : fallback;
}

const LIVE_PROFILES: Record<LiveMediaProfile, { video: VideoSpec | null; audio: AudioSpec[] }> = {
  clock: { video: video('testsrc2', 960, 540, 25, 700), audio: [stereo('eng', 'English', 440)] },
  bars: { video: video('smptehdbars', 960, 540, 25, 500), audio: [stereo('eng', 'English', 1000)] },
  bilingual: { video: video('testsrc2', 960, 540, 25, 700), audio: [stereo('ara', 'العربية', 440), stereo('eng', 'English', 660)] },
  hd: { video: video('testsrc2', 1280, 720, 50, 1800), audio: [stereo('eng', 'English', 550)] },
  fhd: { video: video('testsrc2', 1920, 1080, 25, 2500), audio: [stereo('eng', 'English', 600)] },
  // AAC frames (1024 samples) can't end exactly on a 6 s boundary, so audio-only cuts would drift.
  radio: { video: null, audio: [{ lang: 'eng', title: 'English', codec: 'mp3', channels: 2, freq: 523 }] },
};

export function liveAsset(channel: LiveChannel): LiveAsset {
  const profile = LIVE_PROFILES[channel.media];
  return {
    kind: 'live',
    key: String(channel.id),
    label: [`CH ${channel.num}  #${channel.id}  ${channel.media}`, asciiLabel(channel.name, `Channel ${channel.num} (non-Latin name)`)],
    video: profile.video,
    audio: profile.audio,
  };
}

export const GENERIC_LIVE: LiveAsset = {
  kind: 'live',
  key: 'generic',
  label: ['Zoma test signal', 'generic channel loop'],
  video: LIVE_PROFILES.clock.video,
  audio: LIVE_PROFILES.clock.audio,
};

const SUBTITLES: SubtitleSpec[] = [
  { lang: 'ara', title: 'العربية' },
  { lang: 'eng', title: 'English' },
];

function fileProfile(media: FileMediaProfile, ext: 'mp4' | 'mkv', durationSecs: number): Omit<FileAsset, 'kind' | 'key' | 'label' | 'ext' | 'durationSecs'> {
  switch (media) {
    case 'hevc-4k':
      return {
        clipSecs: Math.min(durationSecs, 10),
        video: video('smptehdbars', 3840, 2160, 25, 4000, 'hevc'),
        audio: [stereo('eng', 'English', 440)],
        subtitles: [],
      };
    case 'multi-audio':
      return {
        clipSecs: Math.min(durationSecs, FULL_ENCODE_MAX_SECONDS),
        video: video('testsrc2', 640, 360, 25, 300),
        audio: [
          stereo('ara', 'العربية', 440),
          stereo('eng', 'English', 660),
          stereo('spa', 'Español', 880),
          { lang: 'eng', title: 'English 5.1 (AC3)', codec: 'ac3', channels: 6, freq: 300 },
          { lang: 'eng', title: 'English 5.1 (E-AC3)', codec: 'eac3', channels: 6, freq: 350 },
        ],
        subtitles: SUBTITLES,
      };
    case 'vod':
      return {
        clipSecs: durationSecs <= FULL_ENCODE_MAX_SECONDS ? durationSecs : 60,
        video: video('testsrc2', 640, 360, 25, 300),
        audio: [stereo('eng', 'English', 440)],
        subtitles: SUBTITLES,
      };
    default: {
      // open-movie:<key> stand-in, until the film is fetched.
      return {
        clipSecs: STAND_IN_CLIP_SECONDS,
        video: video('smptehdbars', 640, 360, 25, 250),
        audio: [stereo('eng', 'English', 440)],
        subtitles: [],
        openMovie: media.slice('open-movie:'.length) as OpenMovieKey,
      };
    }
  }
}

function containerOf(ext: string): 'mp4' | 'mkv' | undefined {
  const e = ext.toLowerCase();
  return e === 'mp4' || e === 'm4v' ? 'mp4' : e === 'mkv' ? 'mkv' : undefined;
}

export function movieAsset(movie: Movie): FileAsset | undefined {
  const ext = containerOf(movie.ext);
  if (!ext) return undefined;
  const p = fileProfile(movie.media, ext, movie.durationSecs);
  const label = p.openMovie
    ? [asciiLabel(movie.name, `Movie ${movie.id}`), 'open movie not downloaded', 'run: pnpm mock:open-movies']
    : [asciiLabel(movie.name, `Movie ${movie.id}`), `MOVIE #${movie.id}  ${movie.media}`];
  return { kind: 'file', key: `movie:${movie.id}`, ext, durationSecs: movie.durationSecs, label, ...p };
}

export function episodeAsset(seriesName: string, season: number, episode: Episode): FileAsset | undefined {
  const ext = containerOf(episode.ext);
  if (!ext) return undefined;
  const p = fileProfile(episode.media, ext, episode.durationSecs);
  const label = [
    asciiLabel(`${seriesName} - ${episode.title}`, `Episode ${episode.id}`),
    `S${season}E${episode.episodeNum}  #${episode.id}  ${episode.media}`,
  ];
  return { kind: 'file', key: `episode:${episode.id}`, ext, durationSecs: episode.durationSecs, label, ...p };
}

export function genericFile(ext: 'mp4' | 'mkv'): FileAsset {
  return {
    kind: 'file',
    key: `generic:${ext}`,
    ext,
    durationSecs: GENERIC_FILE_SECONDS,
    clipSecs: STAND_IN_CLIP_SECONDS,
    label: ['Zoma test signal', `generic ${ext.toUpperCase()} file`],
    video: video('testsrc2', 640, 360, 25, 250),
    audio: [stereo('eng', 'English', 440)],
    subtitles: [],
  };
}

/**
 * Every asset for a catalog. Big catalogs (more than `maxOwnAssets` channels or files) get only
 * the generic loop and generic files, which FileMedia serves for every id without its own.
 */
export function planMedia(catalog: Catalog, maxOwnAssets = 200): MediaAsset[] {
  const assets: MediaAsset[] = [GENERIC_LIVE, genericFile('mp4'), genericFile('mkv')];
  if (catalog.live.length <= maxOwnAssets) assets.push(...catalog.live.map(liveAsset));
  const files: FileAsset[] = [];
  for (const m of catalog.movies) {
    const a = movieAsset(m);
    if (a) files.push(a);
  }
  for (const s of catalog.series) {
    for (const season of s.seasons) {
      for (const e of season.episodes) {
        const a = episodeAsset(s.name, season.number, e);
        if (a) files.push(a);
      }
    }
  }
  if (files.length <= maxOwnAssets) assets.push(...files);
  return assets;
}

// ---- ffmpeg arguments ---------------------------------------------------------------------

/** A path inside a filter option (fontfile=...): forward slashes, `:` escaped, quoted. */
export function filterPath(path: string): string {
  return `'${path.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")}'`;
}

/**
 * drawtext lines. The text goes through text files (label-N.txt, written by the caller), so
 * labels need no filtergraph escaping. `null` font: no burn-in (no usable font was found).
 */
export function drawtextFilters(lines: number, fontFile: string | null, height: number, clockLine: boolean): string[] {
  if (!fontFile) return [];
  const size = Math.max(16, Math.round(height / 18));
  const filters: string[] = [];
  const total = lines + (clockLine ? 1 : 0);
  for (let i = 0; i < total; i++) {
    filters.push(
      `drawtext=fontfile=${filterPath(fontFile)}:textfile=label-${i}.txt:fontsize=${size}:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=8:x=${size}:y=${size + i * Math.round(size * 1.6)}`,
    );
  }
  return filters;
}

export function liveClockText(fps: number): string {
  return `sec %{pts:gmtime:0:%S}.%{eif:mod(n,${fps}):d:2}`;
}

export const FILE_CLOCK_TEXT = '%{pts:hms}';

/** The burned-in lines (label-0.txt, label-1.txt, …): the label, then a clock line. */
export function labelTexts(asset: MediaAsset): string[] {
  if (!asset.video) return [];
  return [...asset.label, asset.kind === 'live' ? liveClockText(asset.video.fps) : FILE_CLOCK_TEXT];
}

function audioInput(a: AudioSpec): string {
  if (a.channels === 6) {
    // FL FR FC LFE BL BR: a different tone per channel, so a downmix or a dropped channel is audible.
    const tones = [a.freq, a.freq * 1.25, a.freq * 1.5, 60, a.freq * 1.75, a.freq * 2].map((f) => `0.3*sin(2*PI*${f}*t)`);
    return `aevalsrc=exprs=${tones.join('|')}:channel_layout=5.1:sample_rate=${AUDIO_RATE}`;
  }
  return `sine=frequency=${a.freq}:beep_factor=4:sample_rate=${AUDIO_RATE}`;
}

function audioCodecArgs(a: AudioSpec, index: number): string[] {
  const bitrate = { aac: '96k', ac3: '384k', eac3: '256k', mp3: '128k' }[a.codec];
  return [`-c:a:${index}`, a.codec === 'mp3' ? 'libmp3lame' : a.codec, `-b:a:${index}`, bitrate, `-ac:a:${index}`, String(a.channels)];
}

function videoCodecArgs(v: VideoSpec, ext: 'ts' | 'mp4' | 'mkv'): string[] {
  const gop = v.fps * 2;
  const rate = [`-b:v`, `${v.bitrate}k`, '-maxrate', `${v.bitrate}k`, '-bufsize', `${v.bitrate * 2}k`];
  if (v.codec === 'hevc') {
    return [
      '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-x265-params', `log-level=error:keyint=${gop}:min-keyint=${gop}:scenecut=0`,
      ...rate,
      ...(ext === 'mp4' ? ['-tag:v', 'hvc1'] : []),
    ];
  }
  return [
    '-c:v', 'libx264', '-preset', 'superfast', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0',
    '-force_key_frames', 'expr:gte(t,n_forced*2)',
    ...rate,
  ];
}

/** Language tags, plus track titles except in MP4 (ffmpeg can't read back MP4 track-title udta). */
function metadataArgs(audio: AudioSpec[], subtitles: SubtitleSpec[], container: 'ts' | 'mp4' | 'mkv'): string[] {
  const args: string[] = [];
  const titles = container !== 'mp4';
  audio.forEach((a, i) => args.push(`-metadata:s:a:${i}`, `language=${a.lang}`, ...(titles ? [`-metadata:s:a:${i}`, `title=${a.title}`] : [])));
  subtitles.forEach((s, i) => args.push(`-metadata:s:s:${i}`, `language=${s.lang}`, ...(titles ? [`-metadata:s:s:${i}`, `title=${s.title}`] : [])));
  return args;
}

/**
 * Audio cut short of the loop end in live loops with video. AAC can't fill 60 s with whole
 * frames and the encoder adds priming, so full-length audio would overlap the next lap by a few
 * ms (non-monotonic DTS at every lap). A 100 ms gap once a minute is harmless.
 */
export const LIVE_AUDIO_GAP_SECONDS = 0.1;

/** Sources as lavfi inputs: video first (if any), then one input per audio track. */
function sourceInputs(v: VideoSpec | null, audio: AudioSpec[], seconds: number, audioSeconds = seconds): string[] {
  const args: string[] = [];
  if (v) args.push('-f', 'lavfi', '-i', `${v.source}=size=${v.width}x${v.height}:rate=${v.fps}`);
  for (const a of audio) {
    if (audioSeconds < seconds) args.push('-t', String(audioSeconds));
    args.push('-f', 'lavfi', '-i', audioInput(a));
  }
  args.push('-t', String(seconds));
  return args;
}

function mapSources(v: VideoSpec | null, audio: AudioSpec[], filters: string[]): string[] {
  const args: string[] = [];
  if (v) {
    if (filters.length > 0) args.push('-filter_complex', `[0:v]${filters.join(',')}[v]`, '-map', '[v]');
    else args.push('-map', '0:v');
  }
  const first = v ? 1 : 0;
  audio.forEach((_, i) => args.push('-map', `${first + i}:a`));
  return args;
}

/**
 * One live loop: run in the asset's folder; writes seg-0.ts … seg-9.ts and index.m3u8 (the
 * completion marker). Each segment starts with PAT/PMT and a keyframe.
 */
export function liveArgs(asset: LiveAsset, fontFile: string | null): string[] {
  const v = asset.video;
  const filters = v ? drawtextFilters(asset.label.length, fontFile, v.height, true) : [];
  return [
    '-hide_banner', '-nostdin', '-v', 'error', '-y',
    ...sourceInputs(v, asset.audio, LIVE_LOOP_SECONDS, v ? LIVE_LOOP_SECONDS - LIVE_AUDIO_GAP_SECONDS : LIVE_LOOP_SECONDS),
    ...mapSources(v, asset.audio, filters),
    ...(v ? videoCodecArgs(v, 'ts') : []),
    ...asset.audio.flatMap((a, i) => audioCodecArgs(a, i)),
    ...metadataArgs(asset.audio, [], 'ts'),
    '-f', 'hls', '-hls_time', String(SEGMENT_SECONDS), '-hls_list_size', '0', '-hls_segment_type', 'mpegts',
    '-hls_flags', 'independent_segments', '-hls_segment_filename', 'seg-%d.ts',
    'index.m3u8',
  ];
}

/** Step 1 of a file: the audio/video clip (clip.mkv), run in a scratch folder. */
export function fileClipArgs(asset: FileAsset, fontFile: string | null): string[] {
  const v = asset.video;
  const filters = drawtextFilters(asset.label.length, fontFile, v.height, true);
  return [
    '-hide_banner', '-nostdin', '-v', 'error', '-y',
    ...sourceInputs(v, asset.audio, asset.clipSecs),
    ...mapSources(v, asset.audio, filters),
    ...videoCodecArgs(v, 'mkv'),
    ...asset.audio.flatMap((a, i) => audioCodecArgs(a, i)),
    'clip.mkv',
  ];
}

/** Step 2: loop the clip to full length (stream copy), add the subtitles and the language tags. */
export function fileMuxArgs(asset: FileAsset, output: string): string[] {
  const looped = asset.clipSecs < asset.durationSecs;
  const args = ['-hide_banner', '-nostdin', '-v', 'error', '-y'];
  if (looped) args.push('-stream_loop', '-1');
  args.push('-i', 'clip.mkv');
  asset.subtitles.forEach((s) => args.push('-i', `sub-${s.lang}.srt`));
  args.push('-map', '0:v', '-map', '0:a');
  asset.subtitles.forEach((_, i) => args.push('-map', `${i + 1}:s`));
  args.push('-c:v', 'copy', '-c:a', 'copy');
  if (asset.subtitles.length > 0) args.push('-c:s', asset.ext === 'mp4' ? 'mov_text' : 'srt');
  if (asset.video.codec === 'hevc' && asset.ext === 'mp4') args.push('-tag:v', 'hvc1');
  args.push(...metadataArgs(asset.audio, asset.subtitles, asset.ext));
  args.push('-t', String(asset.durationSecs));
  if (asset.ext === 'mp4') args.push('-movflags', '+faststart');
  args.push(output);
  return args;
}

function srtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},000`;
}

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const arabicDigits = (text: string): string => text.replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)] ?? d);

/** A cue every 5 s for the whole file, saying where it is ("Subtitle 01:05"). */
export function srtText(lang: SubtitleSpec['lang'], durationSecs: number): string {
  const cues: string[] = [];
  for (let start = 0, n = 1; start < durationSecs; start += 5, n++) {
    const end = Math.min(start + 4, durationSecs);
    const mmss = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
    const text = lang === 'ara' ? `ترجمة عربية ${arabicDigits(mmss)}` : `English subtitle ${mmss}`;
    cues.push(`${n}\n${srtTime(start)} --> ${srtTime(end)}\n${text}\n`);
  }
  return cues.join('\n');
}

/** Short stable hash of everything that shapes an asset's bytes, for the cache folder name. */
export function assetHash(asset: MediaAsset, fontFile: string | null): string {
  const args = asset.kind === 'live' ? liveArgs(asset, fontFile) : [...fileClipArgs(asset, fontFile), ...fileMuxArgs(asset, 'out')];
  return createHash('sha256')
    .update(JSON.stringify({ v: MEDIA_GENERATOR_VERSION, asset, args, texts: labelTexts(asset) }))
    .digest('hex')
    .slice(0, 10);
}

/** Filesystem-safe name for an asset key (`movie:201` -> `movie-201`). */
export function assetSlug(asset: MediaAsset): string {
  return `${asset.kind === 'live' ? 'live-' : ''}${asset.key.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}
