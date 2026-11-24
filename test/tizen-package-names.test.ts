// The two copies of the `.wgt` name rule agree (RELAY step 39s5): tools/build writes the package
// under `tizenPackageFile`'s name and `pnpm device` asks for `tizenPackageName`'s. The tools don't
// import each other, so this test holds them together.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { labManifest } from '../tools/build/src/lab';
import { tizenPackageFile } from '../tools/build/src/package';
import { fillTemplate } from '../tools/build/src/platform-files';
import { tizenPackageName } from '../tools/device/src/commands';

const APP = fillTemplate(readFileSync(path.resolve(import.meta.dirname, '../platforms/tizen/config.xml'), 'utf8'), '0.1.0');

describe('the .wgt the build writes is the one pnpm device installs', () => {
  it('for the app and the lab, two different files', () => {
    const lab = labManifest('tizen', APP);
    expect(tizenPackageName(APP)).toBe(tizenPackageFile(APP));
    expect(tizenPackageName(lab)).toBe(tizenPackageFile(lab));
    expect(tizenPackageName(lab)).not.toBe(tizenPackageName(APP));
  });

  it('for names with every kind of space, and none', () => {
    for (const name of ['Lablo', 'Lablo Lab', ' Lablo\tLab\n', 'لابلو', 'Lablo\u00a0Lab', 'a b c', 'Lablo-Lab_2']) {
      const config = APP.replace('<name>Lablo</name>', `<name>${name}</name>`);
      expect(tizenPackageName(config)).toBe(tizenPackageFile(config));
    }
    expect(tizenPackageName('<widget><name> </name></widget>')).toBeNull();
    expect(() => tizenPackageFile('<widget><name> </name></widget>')).toThrow();
  });
});
