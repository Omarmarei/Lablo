// Which CI jobs a pull request needs, from the files it changes (`.github/workflows/ci.yml`'s
// `changes` job; RELAY steps 40ci and 54). Docs alone run none; the old engines run when the TV
// bundles or their harness can change; media when the code its tests play, ingest or serve does;
// web when the backend or the packages it shares with the TV do.
//
//   node .github/scripts/changes.mjs <file listing the changed paths, one per line>
//
// prints `code=…`, `engines=…`, `media=…` and `web=…` lines (true or false) for $GITHUB_OUTPUT.
// `test/ci-changes.test.ts` runs it on recorded pull requests.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** Files every job depends on: the workspace, the lockfile, the workflow and its scripts. */
const SHARED = /^package\.json$|^pnpm-lock\.yaml$|^pnpm-workspace\.yaml$|^\.github\//;

const ENGINES = /^apps\/tv\/|^packages\/[^/]+\/src\/|^packages\/crypto\/test\/|^tools\/(engines|build|fonts)\//;

/**
 * What the media job's tests exercise (`pnpm verify:media`, `pnpm bench`, the mock's image): the
 * mock and its media, the scale fixtures and benchmarks, the data layer with what it builds on
 * (core, crypto, protocol), and the player through Chromium (player, platform-api,
 * platform-browser; the TV app's player, lab and data folders, and the pages the media specs
 * open). Left to the nightly run: the screens (packages/ui and the rest of apps/tv/src, covered by
 * the chromium e2e) and the TVs' own platforms (platform-tizen, platform-webos), which Chromium
 * never runs.
 */
const MEDIA =
  /^apps\/mock-provider\/|^tools\/(fixtures|bench)\/|^packages\/(core|crypto|data|player|platform-api|platform-browser|protocol)\/src\/|^apps\/tv\/src\/(player|lab|data)\/|^apps\/tv\/(playback|lab)\.html$|^apps\/tv\/vite\.config\.ts$|^vitest\.media\.config\.ts$|^playwright\.config\.ts$/;
/** The media tests and specs themselves. */
const MEDIA_TESTS = /\.media\.test\.ts$|-media\.spec\.ts$/;

/**
 * The TV's pairing against the real API (e2e/pairing-api.spec.ts, step 31c3) runs the TV's dev
 * app and the mock: their sources and the spec's own files count too.
 */
const WEB =
  /^apps\/(web|tv|mock-provider)\/|^packages\/(protocol|crypto)\/|^packages\/[^/]+\/src\/|^config\/|^vitest\.web\.config\.ts$|^playwright\.web\.config\.ts$|^e2e\/(pairing-api\.spec|api-front|pairing-steps|config-server|onboard|remote-driver|remote-keys)\.ts$|^tools\/engines\/src\/(pair-phone|pair-server|pair-stand-in|config)\.ts$/;

/**
 * The jobs `files` (paths from the repository's root) need.
 * @param {readonly string[]} files
 * @returns {{ code: boolean, engines: boolean, media: boolean, web: boolean }}
 */
export function jobsFor(files) {
  // Not docs; then not tests either (what ends up in a build or a tool).
  const code = files.filter((f) => !/\.md$|^docs\/|^LICENSE/.test(f));
  const source = code.filter((f) => !/\.test\.tsx?$|^test\/|^e2e\//.test(f));
  /** @type {(list: readonly string[], re: RegExp) => boolean} */
  const any = (list, re) => list.some((f) => SHARED.test(f) || re.test(f));
  return {
    code: code.length > 0,
    engines: any(source, ENGINES),
    media: any(source, MEDIA) || code.some((f) => MEDIA_TESTS.test(f)),
    web: any(code, WEB),
  };
}

// Run as a script (the test imports it instead).
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const list = process.argv[2];
  if (list === undefined) throw new Error('Usage: node .github/scripts/changes.mjs <file listing the changed paths>');
  const files = readFileSync(list, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const jobs = jobsFor(files);
  for (const [job, needed] of Object.entries(jobs)) process.stdout.write(`${job}=${needed}\n`);
}
