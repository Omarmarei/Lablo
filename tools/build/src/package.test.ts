import type * as ChildProcess from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { labManifest } from './lab';
import { packageTizen, tizenPackageFile } from './package';
import { fillTemplate } from './platform-files';

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcess>()),
  spawnSync: vi.fn(),
}));

const ROOT = path.resolve(import.meta.dirname, '../../..');
const APP_CONFIG = fillTemplate(readFileSync(path.join(ROOT, 'platforms/tizen/config.xml'), 'utf8'), '0.1.3');

describe('the .wgt names (RELAY step 39s5)', () => {
  // The TV failed to install `Lablo Lab.wgt` (docs/spikes/results.md, "From the Samsung TV").
  it('are the widget names without spaces', () => {
    expect(tizenPackageFile(APP_CONFIG)).toBe('Lablo.wgt');
    expect(tizenPackageFile(labManifest('tizen', APP_CONFIG))).toBe('LabloLab.wgt');
  });

  it('drop every kind of space and read a name with attributes', () => {
    expect(tizenPackageFile('<widget><name xml:lang="en">\n\t Lablo  Lab\u00a0Two \n</name></widget>')).toBe('LabloLabTwo.wgt');
    expect(tizenPackageFile('<widget><name>A</name><name>B</name></widget>')).toBe('A.wgt');
  });

  it('refuse a manifest without a name', () => {
    expect(() => tizenPackageFile('<widget/>')).toThrow('config.xml has no widget <name> to name the .wgt after');
    expect(() => tizenPackageFile('<widget><name> \n </name></widget>')).toThrow('no widget <name>');
    expect(() => tizenPackageFile('<widget><names>Lablo</names></widget>')).toThrow('no widget <name>');
  });
});

describe('packageTizen with a stand-in Tizen CLI', () => {
  let dir = '';
  const profile = process.env.TIZEN_SIGNING_PROFILE;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'lablo-wgt-'));
    process.env.TIZEN_SIGNING_PROFILE = 'lablo-dev';
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (profile === undefined) delete process.env.TIZEN_SIGNING_PROFILE;
    else process.env.TIZEN_SIGNING_PROFILE = profile;
    vi.mocked(spawnSync).mockReset();
  });

  /** The CLI as on the TV session: `tizen version` answers, `tizen package` writes `<name>.wgt`. */
  function standInCli(stage: string, cliName: string): void {
    vi.mocked(spawnSync).mockImplementation(((_bin: string, args: readonly string[]) => {
      if (args[0] === 'package') writeFileSync(path.join(stage, cliName), 'signed');
      return { status: 0, stdout: '', stderr: '' };
    }) as unknown as typeof spawnSync);
  }

  it('moves the lab package out under its name without a space, and an older build with a space goes', () => {
    const stage = path.join(dir, 'stage');
    const out = path.join(dir, 'packages');
    mkdirSync(stage);
    mkdirSync(out);
    writeFileSync(path.join(stage, 'config.xml'), labManifest('tizen', APP_CONFIG));
    writeFileSync(path.join(out, 'Lablo Lab.wgt'), 'older build');
    writeFileSync(path.join(out, 'LabloLab.wgt'), 'older build');
    writeFileSync(path.join(out, 'Lablo.wgt'), 'the app');
    standInCli(stage, 'Lablo Lab.wgt');

    expect(packageTizen(stage, out)).toEqual({ ok: true, file: path.join(out, 'LabloLab.wgt') });
    expect(readdirSync(out).sort()).toEqual(['Lablo.wgt', 'LabloLab.wgt']);
    expect(readFileSync(path.join(out, 'LabloLab.wgt'), 'utf8')).toBe('signed');
    expect(readFileSync(path.join(out, 'Lablo.wgt'), 'utf8')).toBe('the app');
    expect(existsSync(path.join(stage, 'Lablo Lab.wgt'))).toBe(false);
  });

  it('keeps the app package name as the CLI wrote it', () => {
    const stage = path.join(dir, 'stage');
    const out = path.join(dir, 'packages');
    mkdirSync(stage);
    writeFileSync(path.join(stage, 'config.xml'), APP_CONFIG);
    standInCli(stage, 'Lablo.wgt');

    expect(packageTizen(stage, out)).toEqual({ ok: true, file: path.join(out, 'Lablo.wgt') });
    expect(readdirSync(out)).toEqual(['Lablo.wgt']);
    expect(readFileSync(path.join(out, 'Lablo.wgt'), 'utf8')).toBe('signed');
  });

  it('skips without a signing profile', () => {
    delete process.env.TIZEN_SIGNING_PROFILE;
    expect(packageTizen(path.join(dir, 'stage'), path.join(dir, 'packages'))).toEqual({
      ok: false,
      skipped: 'TIZEN_SIGNING_PROFILE is not set (see docs/runbooks/tv-build.md)',
    });
    expect(spawnSync).not.toHaveBeenCalled();
  });
});
