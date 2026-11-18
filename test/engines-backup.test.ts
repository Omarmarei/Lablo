// RELAY step 32d1: the old-engine harness's wipe walk runs the webOS build on a simulated luna
// bridge and reads the start's screens with its own ES5 probe (tools/* may not import the app or
// the TV adapters). This keeps its copies equal to the webOS adapter's and the app's, and runs the
// bridge through the adapter's own LGUDID read.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { AR } from '../apps/tv/src/i18n/ar';
import { EN } from '../apps/tv/src/i18n/en';
import { DEVICE_ID_URI, readLgudid } from '../packages/platform-webos/src/luna';
import { readAudioGuidance } from '../packages/platform-webos/src/speech';
import { TV_PLATFORMS } from '../tools/build/src/platform-files';
import { DEVICE_ID_URI as HARNESS_DEVICE_ID_URI, SIM_LGUDID, SIM_PLATFORM, WEBOS_SIM_BRIDGE, WELCOME_TITLES } from '../tools/engines/src/backup-walk';
import type { ServiceBridge } from '../packages/platform-webos/src/luna';

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
