// RELAY step 32d1: the old-engine harness's wipe walk runs the webOS build on a simulated luna
// bridge and reads the start's screens with its own ES5 probe (tools/* may not import the app or
// the TV adapters). This keeps its copies equal to the webOS adapter's and the app's, and runs the
// bridge through the adapter's own LGUDID read. Step 32d3d: the code walk's copies too (the code
// screen's field, row and texts, where the app starts again, where the code is kept).

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { restartUrl } from '../apps/tv/src/data/params';
import { AR } from '../apps/tv/src/i18n/ar';
import { EN } from '../apps/tv/src/i18n/en';
import { BACKUP_CODE_KEY } from '../packages/data/src/backup-service';
import { STORE } from '../packages/data/src/schema';
import { DEVICE_ID_URI, readLgudid } from '../packages/platform-webos/src/luna';
import { readAudioGuidance } from '../packages/platform-webos/src/speech';
import { TV_PLATFORMS } from '../tools/build/src/platform-files';
import { DEVICE_ID_URI as HARNESS_DEVICE_ID_URI, SIM_LGUDID, SIM_PLATFORM, WEBOS_SIM_BRIDGE, WELCOME_TITLES } from '../tools/engines/src/backup-walk';
import { CODE_ALPHABET, CODE_INPUT, CODE_KV, CODE_PLATFORM, CODE_ROW, CODE_TEXT, codeRestoreSteps, codeWalkUrl, restartedUrl, tizenAppId } from '../tools/engines/src/code-walk';
import type { ServiceBridge } from '../packages/platform-webos/src/luna';
import { appIdFor } from '../tv-defines.config';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

/** The simulated bridge in a realm of its own: a factory as the adapter takes it. */
function simBridge(): { factory: () => ServiceBridge; calls: () => string[] } {
  // (The realm's global object; not named `window`, which lint keeps for the platform adapters.)
  const page: Record<string, unknown> = {};
  runInNewContext(WEBOS_SIM_BRIDGE, { window: page, setTimeout });
  const Bridge = page['PalmServiceBridge'] as new () => ServiceBridge;
  return { factory: () => new Bridge(), calls: () => [...(page['__labloLuna'] as string[])] };
}

describe("the wipe walk's simulated webOS", () => {
  it("answers the webOS adapter's own LGUDID call", async () => {
    expect(HARNESS_DEVICE_ID_URI).toBe(DEVICE_ID_URI);
    const sim = simBridge();
    expect(await readLgudid(sim.factory)).toBe(SIM_LGUDID);
    expect(sim.calls()).toEqual([DEVICE_ID_URI]);
  });

  it('refuses the other calls the adapter makes, which it reads as no answer', async () => {
    const sim = simBridge();
    const guidance = await readAudioGuidance(sim.factory);
    expect(guidance.on).toBeNull();
    expect(sim.calls()).toEqual(['luna://com.webos.settingsservice/getSystemSettings']);
  });

  it("derives with the webOS build's platform", () => {
    expect(TV_PLATFORMS).toContain(SIM_PLATFORM);
  });
});

describe("the wipe walk's probe of the start's screens", () => {
  it('shows "Welcome back" as the catalogs say it', () => {
    expect(WELCOME_TITLES).toEqual({ en: EN['backup.welcomeTitle'], ar: AR['backup.welcomeTitle'] });
  });

  it('reads the attributes the start screen draws', () => {
    const view = read('apps/tv/src/backup/BackupStartApp.tsx');
    for (const mark of ['data-testid="backup-start"', 'data-screen="welcome"', 'data-zone={focus.zone}', 'data-index={focus.index}', 'data-language={shownIn}', 'data-sources={start.sources.value}', 'data-testid="backup-title"']) {
      expect(view, mark).toContain(mark);
    }
  });

  it("uploads through the test hook's uploadBackup", () => {
    expect(read('apps/tv/src/test-hook.ts')).toMatch(/\buploadBackup\(\): Promise<string \| null>/);
  });
});

describe("the code walk's copies of the app (step 32d3d)", () => {
  // (Read as text: the onboarding modules reach @lablo/ui's components, which the root typecheck can't compile.)
  it("types into the code screen's field, on the source screen's row for it", () => {
    const code = read('apps/tv/src/onboarding/restore-code.ts');
    expect(code).toContain(`export const CODE_FIELD = '${CODE_INPUT}';`);
    expect(code).toContain("export const RESTORE_CODE_SCREEN = 'restore-code';");
    expect(new Set(codeRestoreSteps('en', '0'.repeat(26)).map((step) => step.expect.screen))).toContain('restore-code');
    // The rows: the two forms, "Use your phone", then "Use a backup code".
    const state = read('apps/tv/src/onboarding/onboarding-state.ts');
    expect(state).toContain("export const SOURCE_TYPES: readonly SourceType[] = ['xtream', 'm3u'];");
    expect(state).toContain(["  const rows: SourceRow[] = SOURCE_TYPES.slice();", "  if (pairing) rows.push('phone');", "  if (restore) rows.push('restore');"].join('\n'));
    expect(CODE_ROW).toBe(3);
  });

  it("reads the marks the code screen draws", () => {
    const view = read('apps/tv/src/onboarding/RestoreCodePage.tsx');
    for (const mark of ["'data-testid': 'restore-code'", "'data-phase': phase", "'data-problem': problem ?? ''", "'data-notice': notice ?? ''", 'data-testid="onboarding-title"', 'data-testid="restore-notice"', 'dir="ltr"']) {
      expect(view, mark).toContain(mark);
    }
  });

  it('shows the code screen, "Opening your backup…" and the answer as the catalogs give them', () => {
    expect(CODE_TEXT).toEqual({
      en: { title: EN['restore.title'], opening: EN['restore.opening'], none: EN['restore.none'] },
      ar: { title: AR['restore.title'], opening: AR['restore.opening'], none: AR['restore.none'] },
    });
  });

  it('follows the app to where it starts again after a restore', () => {
    expect(restartedUrl(codeWalkUrl('app'))).toBe(restartUrl(codeWalkUrl('app')));
    expect(restartedUrl('file:///app/app/tizen/index.html')).toBe(restartUrl('file:///app/app/tizen/index.html'));
  });

  it("reads the code where the backup service keeps it", () => {
    expect(CODE_KV).toEqual({ store: STORE.kv, key: BACKUP_CODE_KEY });
  });

  it("salts as the Tizen build does: its platform, and its manifest's app id", () => {
    expect(TV_PLATFORMS).toContain(CODE_PLATFORM);
    const dir = mkdtempSync(path.join(tmpdir(), 'lablo-code-'));
    try {
      mkdirSync(path.join(dir, CODE_PLATFORM));
      writeFileSync(path.join(dir, CODE_PLATFORM, 'config.xml'), read('platforms/tizen/config.xml'));
      expect(tizenAppId(dir)).toBe(appIdFor('tizen'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("mistypes with the code's own alphabet", () => {
    expect(read('packages/crypto/src/backup-code.ts')).toContain(`const ALPHABET = '${CODE_ALPHABET}';`);
  });
});
