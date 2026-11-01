import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkSyntax } from './syntax-gate';
import {
  BOOT_ERROR_SCRIPT,
  assertAppVersion,
  checkAppinfo,
  checkConfigXml,
  fillTemplate,
  foreignCode,
  renderIndexHtml,
} from './platform-files';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

describe('index.html', () => {
  it('loads the classic-script bundle after the boot-error handler', () => {
    const html = renderIndexHtml('webos');
    expect(html).toContain('<script src="main.js"></script>');
    expect(html).not.toContain('type="module"');
    expect(html.indexOf('window.onerror')).toBeLessThan(html.indexOf('main.js'));
    expect(html).not.toContain('webapis.js');
  });

  it('adds Samsung webapis on Tizen only', () => {
    expect(renderIndexHtml('tizen')).toContain('<script src="$WEBAPIS/webapis/webapis.js"></script>');
  });

  it('keeps the inline boot-error script within ES2016', () => {
    expect(checkSyntax(BOOT_ERROR_SCRIPT, 'boot-error')).toBeNull();
  });
});

describe('platform manifests', () => {
  it('accepts valid versions and rejects others', () => {
    expect(() => assertAppVersion('0.1.0')).not.toThrow();
    expect(() => assertAppVersion('255.255.65535')).not.toThrow();
    for (const bad of ['1.0', '1.0.0-beta', '256.0.0', '1.0.65536', 'v1.0.0']) {
      expect(() => assertAppVersion(bad)).toThrow(/major\.minor\.patch/);
    }
  });

  it('fills the version placeholder', () => {
    expect(fillTemplate('a {{version}} b {{version}}', '1.2.3')).toBe('a 1.2.3 b 1.2.3');
    expect(() => fillTemplate('no placeholder', '1.2.3')).toThrow(/placeholder/);
  });

  it('the real webOS appinfo.json passes and keeps disableBackHistoryAPI', () => {
    const info = checkAppinfo(fillTemplate(read('platforms/webos/appinfo.json'), '0.1.0'), '0.1.0');
    expect(info).toEqual({ id: 'com.zoma.iptv', version: '0.1.0' });
  });

  it('rejects an appinfo.json without disableBackHistoryAPI', () => {
    const text = JSON.stringify({ id: 'a.b', version: '1.0.0', main: 'index.html', type: 'web' });
    expect(() => checkAppinfo(text, '1.0.0')).toThrow(/disableBackHistoryAPI/);
  });

  it('the real Tizen config.xml passes', () => {
    expect(checkConfigXml(fillTemplate(read('platforms/tizen/config.xml'), '0.1.0'), '0.1.0')).toEqual({
      appId: 'ZomaIPTV01.Zoma',
    });
  });

  it('rejects a config.xml with the wrong version', () => {
    const text = fillTemplate(read('platforms/tizen/config.xml'), '0.1.0');
    expect(() => checkConfigXml(text, '0.2.0')).toThrow(/widget version/);
  });
});

describe('foreignCode', () => {
  it('finds the other platform adapters in a bundle', () => {
    expect(foreignCode('tizen', 'x.PalmSystem.deviceInfo')).toEqual(['PalmSystem']);
    expect(foreignCode('webos', 'tizen.tvinputdevice.registerKey')).toEqual(['tvinputdevice']);
    expect(foreignCode('webos', 'model:"Desktop browser"')).toEqual(['Desktop browser']);
    expect(foreignCode('tizen', 'tizen.tvinputdevice')).toEqual([]);
  });
});
