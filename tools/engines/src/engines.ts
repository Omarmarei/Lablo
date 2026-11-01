/**
 * The old Chromium engines the TV build must run on (docs/PLAN.md §3, ADR-003).
 *
 * Each entry is a Linux x64 snapshot from the public `chromium-browser-snapshots` bucket. The
 * position is the closest snapshot just below the milestone's branch point, so the build still
 * reports that major version (the harness checks the user agent). The SHA-256 pins the exact zip.
 * The CI cache key hashes this file: changing an engine re-downloads it.
 */
export interface Engine {
  /** Short id, used on the command line (`--engine chrome53`) and in reports. */
  readonly id: string;
  /** The Chromium major version the snapshot must report. */
  readonly major: number;
  /** Chromium commit position of the snapshot. */
  readonly position: number;
  readonly sha256: string;
  readonly bytes: number;
  /** The TVs this engine stands in for. */
  readonly tvs: string;
}

export const ENGINES: readonly Engine[] = [
  {
    id: 'chrome53',
    major: 53,
    position: 403380, // M53 branch point 403382
    sha256: '898c9414f2606725121165e023a990a7118ddba56eefa6038d108d8534882080',
    bytes: 84_634_905,
    tvs: 'LG webOS 4.x (2018)',
  },
  {
    id: 'chrome56',
    major: 56,
    position: 433042, // M56 branch point 433059
    sha256: '4fcdb16eb22f59340eea65e90dc4c18d925db8504d38ecc73bcc2a906179381a',
    bytes: 87_066_332,
    tvs: 'Samsung Tizen 4.0 (2018)',
  },
  {
    id: 'chrome68',
    major: 68,
    position: 561732, // M68 branch point 561733 (550428 is M67's)
    sha256: '6933d0afce6e17304b62029fbbd246cbe9e130eb0d90d7682d3765d3dbc8e1c8',
    bytes: 105_410_045,
    tvs: 'LG webOS 5 (2020); Samsung Tizen 5.5 (2020) runs Chromium 69',
  },
];

/**
 * Chromium switches that model the TV runtime around a packaged app. The TV app runtimes
 * (webOS WAM, Tizen WRT) load the app from file:// with file-URL access granted. Desktop
 * Chromium does not, and then denies IndexedDB inside a Blob worker (its origin is opaque) on
 * 53, 56 and 68 alike, while main-thread IndexedDB works (probe of 2026-11-02). Without this
 * switch the harness would test a desktop policy instead of the TV's. Spike S1 confirms
 * IndexedDB inside a Blob worker on the real TVs; see docs/runbooks/old-engines.md.
 */
export const TV_RUNTIME_FLAGS: readonly string[] = ['--allow-file-access-from-files'];

export function snapshotUrl(engine: Pick<Engine, 'position'>): string {
  return `https://commondatastorage.googleapis.com/chromium-browser-snapshots/Linux_x64/${engine.position}/chrome-linux.zip`;
}

/** Picks engines by id; an empty selection means all of them. */
export function selectEngines(ids: readonly string[]): Engine[] {
  if (ids.length === 0) return [...ENGINES];
  const unknown = ids.filter((id) => !ENGINES.some((engine) => engine.id === id));
  if (unknown.length > 0) {
    throw new Error(`unknown --engine ${unknown.join(', ')} (expected ${ENGINES.map((e) => e.id).join(', ')})`);
  }
  return ENGINES.filter((engine) => ids.includes(engine.id));
}

/** `Mozilla/5.0 … Chrome/53.0.2785.0 Safari/537.36` → 53. */
export function chromeMajor(userAgent: string): number | null {
  const match = /\bChrome\/(\d+)\./.exec(userAgent);
  return match?.[1] === undefined ? null : Number(match[1]);
}
