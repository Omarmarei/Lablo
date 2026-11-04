import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAB_ACG, LUNA_ACG, PLATFORM_LUNA_CALLS, checkAcg, lunaUris } from './acg';
import { checkAppinfo, fillTemplate } from './platform-files';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

const DEVICE_ID = 'luna://com.webos.service.sm/deviceid/getIDs';
const SETTINGS = 'luna://com.webos.settingsservice/getSystemSettings';
const TTS = 'luna://com.webos.service.tts/speak';

/** A minified-looking bundle that carries the given luna URIs. */
const bundle = (...uris: string[]): string => uris.map((uri, i) => `function f${i}(e){return $h("${uri}",'{"a":1}',{bridge:e})}`).join(';');

describe('lunaUris', () => {
  it('finds each luna URI once, in order, inside minified code', () => {
    expect(lunaUris(`${bundle(DEVICE_ID, TTS)};x("${DEVICE_ID}")`)).toEqual([DEVICE_ID, TTS]);
    expect(lunaUris('var u="luna://com.webos.media/selectTrack"')).toEqual(['luna://com.webos.media/selectTrack']);
  });

  it('finds nothing in a bundle without luna calls', () => {
    expect(lunaUris('var x="https://example.invalid/luna";')).toEqual([]);
  });
});

describe('checkAcg (ADR-012)', () => {
  it('accepts [] for a bundle that carries luna calls it does not make (the app)', () => {
    expect(checkAcg(bundle(DEVICE_ID, SETTINGS, TTS), [], { declareBundle: false })).toEqual([]);
  });

  it("wants every group of the lab's luna calls declared, but none for services LG does not list", () => {
    expect(checkAcg(bundle(DEVICE_ID, SETTINGS, TTS), ['deviceinfo.query', 'settings.query'], { declareBundle: true })).toEqual([]);
    expect(checkAcg(bundle(DEVICE_ID, SETTINGS), ['deviceinfo.query'], { declareBundle: true })).toEqual([`${SETTINGS} needs "settings.query" in "requiredACG"`]);
  });

  it('rejects a luna URI that LUNA_ACG does not know, in the app and in the lab', () => {
    const unknown = 'luna://com.webos.service.example/doIt';
    for (const declareBundle of [false, true]) {
      expect(checkAcg(bundle(unknown), [], { declareBundle })).toEqual([expect.stringContaining(`${unknown} is not in LUNA_ACG`)]);
    }
  });

  it('rejects a group that no known luna call needs', () => {
    expect(checkAcg('', ['network.query'], { declareBundle: false })).toEqual([expect.stringContaining('"network.query"')]);
  });

  it.each([undefined, null, 'deviceinfo.query', {}, [1]])('rejects requiredACG %j', (value) => {
    expect(checkAcg('', value, { declareBundle: false })).toEqual([expect.stringContaining('must be an array')]);
  });

  it('knows the lab groups, and each platform call', () => {
    const groups = Object.values(LUNA_ACG);
    for (const group of LAB_ACG) expect(groups).toContain(group);
    for (const uri of Object.values(PLATFORM_LUNA_CALLS)) expect(Object.keys(LUNA_ACG)).toContain(uri);
  });
});

describe('the app manifest declares the group of every luna call the app makes', () => {
  /** App code that can reach a Platform: everything in apps/tv/src and packages/ui/src except the lab and tests. */
  function appSources(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== 'lab') out.push(...appSources(full));
      } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        out.push(full);
      }
    }
    return out;
  }

  it('finds no luna-backed Platform call without its group in platforms/webos/appinfo.json', () => {
    const declared = checkAppinfo(fillTemplate(read('platforms/webos/appinfo.json'), '0.1.0'), '0.1.0').requiredACG;
    const missing: string[] = [];
    for (const file of [...appSources(path.join(ROOT, 'apps/tv/src')), ...appSources(path.join(ROOT, 'packages/ui/src'))]) {
      const text = readFileSync(file, 'utf8');
      for (const [method, uri] of Object.entries(PLATFORM_LUNA_CALLS)) {
        const group = LUNA_ACG[uri];
        if (group !== null && group !== undefined && new RegExp(`\\.${method}\\(`).test(text) && !declared.includes(group)) {
          missing.push(`${path.relative(ROOT, file)} calls ${method}() and needs "${group}"`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('would catch one (the scan finds the lab calling deviceSecret)', () => {
    expect(/\.deviceSecret\(/.test(read('apps/tv/src/lab/lab-main.tsx'))).toBe(true);
  });
});
