// RELAY step 54: CI's `changes` job (.github/scripts/changes.mjs) on recorded pull requests' files,
// and on one path per package, so a new package (or a moved media test) needs a decision here.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// A plain ES module for the CI runner; its JSDoc gives the types (the root tsconfig checks JS).
import { jobsFor as jobs } from '../.github/scripts/changes.mjs';

const root = join(import.meta.dirname, '..');

/** The packages whose source the media job's tests exercise, and those left to the nightly run. */
const MEDIA_PACKAGES = ['core', 'crypto', 'data', 'player', 'platform-api', 'platform-browser', 'protocol'];
const NIGHTLY_PACKAGES = ['platform-tizen', 'platform-webos', 'ui'];

describe('the changes job', () => {
  it('runs nothing but docs for docs (PR #197)', () => {
    expect(jobs(['RELAY.md', 'docs/store/README.md', 'docs/store/beta.md'])).toEqual({ code: false, engines: false, media: false, web: false });
  });

  it('leaves media out of a change to the screens (PR #195, the keyboard)', () => {
    const pr195 = [
      'HANDOVER.md',
      'RELAY.md',
      'docs/architecture.md',
      'e2e/keyboard.spec.ts',
      'packages/ui/src/components/ScreenKeyboard.css',
      'packages/ui/src/components/TextField.css',
      'packages/ui/src/components/TextField.tsx',
      'packages/ui/src/components/components.test.ts',
      'packages/ui/src/focus/binding.ts',
      'packages/ui/src/focus/screen-keyboard.test.ts',
      'packages/ui/src/focus/screen-keyboard.ts',
      'packages/ui/src/focus/text-editor-own.test.ts',
      'packages/ui/src/focus/text-editor.ts',
    ];
    expect(jobs(pr195)).toEqual({ code: true, engines: true, media: false, web: true });
    expect(jobs(['apps/tv/src/main.tsx', 'docs/architecture.md'])).toEqual({ code: true, engines: true, media: false, web: true }); // PR #198
  });

  it('runs media for the player (PR #196) and for the lab and the mock (PR #194)', () => {
    expect(jobs(['packages/player/src/ladder.ts', 'packages/platform-tizen/src/avplay-engine.ts', 'tools/tv/src/soak.ts']).media).toBe(true);
    expect(jobs(['apps/mock-provider/src/lab-media.ts', 'apps/tv/src/lab/held-socket.ts', 'packages/platform-tizen/src/avplay.ts']).media).toBe(true);
    expect(jobs(['apps/tv/src/data/refresh-hold.ts']).media).toBe(true);
    expect(jobs(['apps/tv/src/settings/connection-check.ts']).media).toBe(false);
  });

  it('runs media for each package its tests exercise, and not for the others', () => {
    const packages = readdirSync(join(root, 'packages'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    // A new package must be put in one list or the other.
    expect(packages).toEqual([...MEDIA_PACKAGES, ...NIGHTLY_PACKAGES].sort());
    for (const p of MEDIA_PACKAGES) expect(jobs([`packages/${p}/src/x.ts`]), p).toMatchObject({ media: true, engines: true, web: true });
    for (const p of NIGHTLY_PACKAGES) expect(jobs([`packages/${p}/src/x.ts`]), p).toMatchObject({ media: false, engines: true, web: true });
    // A package's own unit tests run in verify; web runs for them too (its filter takes tests).
    expect(jobs(['packages/data/src/epg-store.test.ts'])).toEqual({ code: true, engines: false, media: false, web: true });
  });

  it('runs media for a media test or spec alone, and nothing else', () => {
    expect(jobs(['test/epg-declared-300mb.media.test.ts'])).toEqual({ code: true, engines: false, media: true, web: false });
    expect(jobs(['e2e/player-media.spec.ts'])).toEqual({ code: true, engines: false, media: true, web: false });
    expect(jobs(['vitest.media.config.ts']).media).toBe(true);
  });

  it('runs everything for the workspace, the lockfile and the workflow with its script', () => {
    for (const f of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.github/workflows/ci.yml', '.github/scripts/changes.mjs']) {
      expect(jobs([f]), f).toEqual({ code: true, engines: true, media: true, web: true });
    }
  });

  it('runs only web for the backend', () => {
    expect(jobs(['apps/web/src/app/page.tsx'])).toEqual({ code: true, engines: false, media: false, web: true });
  });

  it('prints one line per job for $GITHUB_OUTPUT', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ci-changes-'));
    try {
      const list = join(dir, 'changed.txt');
      writeFileSync(list, 'packages/ui/src/focus/text-editor.ts\r\nRELAY.md\n\n');
      const out = execFileSync(process.execPath, [join(root, '.github', 'scripts', 'changes.mjs'), list], { encoding: 'utf8' });
      expect(out).toBe('code=true\nengines=true\nmedia=false\nweb=true\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
