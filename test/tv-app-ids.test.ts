// `pnpm tv` and `pnpm device` read the same Tizen application ids (RELAY step 39s6), and on webOS
// `pnpm tv --webos` looks for the page of the app `pnpm device` installs (step 56). The tools don't
// import each other, so each keeps its own copy of the rule and this test holds them together.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { labManifest } from '../tools/build/src/lab';
import { fillTemplate } from '../tools/build/src/platform-files';
import { tizenManifest } from '../tools/device/src/commands';
import { tizenAppId } from '../tools/tv/src/commands';
import { webosAppId, webosPage } from '../tools/tv/src/webos';

const APP = fillTemplate(readFileSync(path.resolve(import.meta.dirname, '../platforms/tizen/config.xml'), 'utf8'), '0.1.0');
const APPINFO = fillTemplate(readFileSync(path.resolve(import.meta.dirname, '../platforms/webos/appinfo.json'), 'utf8'), '0.1.0');

function deviceAppId(config: string): string | null {
  const manifest = tizenManifest(config);
  return typeof manifest === 'string' ? null : manifest.appId;
}

describe('pnpm tv launches what pnpm device installs', () => {
  it('for the app and the lab, two different ids', () => {
    const lab = labManifest('tizen', APP);
    expect(tizenAppId(APP)).toBe(deviceAppId(APP));
    expect(tizenAppId(lab)).toBe(deviceAppId(lab));
    expect(tizenAppId(lab)).not.toBe(tizenAppId(APP));
    expect(tizenAppId(APP)).not.toBeNull();
  });

  it('for odd spacing, and none', () => {
    for (const config of ['<tizen:application id="A.b"/>', '<tizen:application   id="Xy12345678.Lab" package="Xy12345678"/>', '<tizen:application\n id="A.c"/>']) {
      expect(tizenAppId(config)).toBe(deviceAppId(`${config}<name>x</name>`));
    }
    expect(tizenAppId('<widget/>')).toBeNull();
    expect(deviceAppId('<widget><name>x</name></widget>')).toBeNull();
  });
});

describe('pnpm tv --webos looks for what pnpm device installs (step 56)', () => {
  it("reads the app's and the lab's ids as tools/device does (appinfo.json's `id`), and their pages never match each other", () => {
    const lab = labManifest('webos', APPINFO);
    const deviceId = (appinfo: string): string => (JSON.parse(appinfo) as { id: string }).id;
    expect(webosAppId(APPINFO)).toBe(deviceId(APPINFO));
    expect(webosAppId(lab)).toBe(deviceId(lab));
    const app = webosAppId(APPINFO)!;
    const labId = webosAppId(lab)!;
    expect(labId).not.toBe(app);
    const url = (id: string): string => `file:///media/developer/apps/usr/palm/applications/${id}/index.html`;
    expect([url(app).includes(webosPage(app)), url(labId).includes(webosPage(app)), url(app).includes(webosPage(labId)), url(labId).includes(webosPage(labId))]).toEqual([true, false, false, true]);
  });
});
