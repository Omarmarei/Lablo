import { readFileSync } from 'node:fs';
import type { NetworkInterfaceInfo } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { LAB_IDS, checkLabServer, labConfigScript, labManifest, lanAddress, renderLabIndexHtml } from './lab';
import { checkAppinfo, checkConfigXml, fillTemplate } from './platform-files';
import { checkSyntax } from './syntax-gate';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');
const PROBE = read('apps/tv/src/lab/native-probe.js');

describe('the lab manifests (RELAY step 15a)', () => {
  it('give webOS the lab id and name and keep the rest of appinfo.json', () => {
    const app = fillTemplate(read('platforms/webos/appinfo.json'), '0.1.3');
    const lab = labManifest('webos', app);
    expect(checkAppinfo(lab, '0.1.3')).toEqual({ id: 'com.zoma.iptv.lab', version: '0.1.3', requiredACG: ['deviceinfo.query', 'settings.query'] });
    const parsed = JSON.parse(lab) as Record<string, unknown>;
    expect(parsed.title).toBe('Zoma Lab');
    // LG's Audio Guidance reads an app only with this (spike S11).
    expect(parsed.accessibility).toEqual({ supportsAudioGuidance: true });
    const { accessibility: _added, ...rest } = parsed;
    // The lab's luna calls (S3, S11) and their ACG groups; the app's manifest declares none (ADR-012).
    expect((JSON.parse(app) as Record<string, unknown>).requiredACG).toEqual([]);
    expect({ ...rest, id: 'com.zoma.iptv', title: 'Zoma', requiredACG: [] }).toEqual(JSON.parse(app));
  });

  it('give Tizen the lab widget, package and application ids and name, nothing else', () => {
    const app = fillTemplate(read('platforms/tizen/config.xml'), '0.1.3');
    const lab = labManifest('tizen', app);
    expect(checkConfigXml(lab, '0.1.3')).toEqual({ appId: 'ZomaLab001.ZomaLab' });
    expect(lab).toContain('id="https://zoma-iptv.invalid/lab"');
    expect(lab).toContain('package="ZomaLab001"');
    expect(lab).toContain('<name>Zoma Lab</name>');
    const appLines = app.split('\n');
    const changed = lab.split('\n').filter((line, i) => line !== appLines[i]);
    expect(changed).toHaveLength(3);
    // Tizen package ids are 10 letters and digits; the application id is <package>.<name>.
    expect(LAB_IDS.tizenPackage).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(LAB_IDS.tizenApplication.startsWith(`${LAB_IDS.tizenPackage}.`)).toBe(true);
  });

  it('fail loudly when the app manifest changes shape', () => {
    expect(() => labManifest('tizen', '<widget version="1.0.0"></widget>')).toThrow(/widget id not found/);
  });
});

describe('the lab page', () => {
  it('runs the boot-error handler, the native probe and lab-config.js before main.js', () => {
    const html = renderLabIndexHtml('webos', PROBE);
    const order = ['window.onerror', '__ZOMA_LAB_NATIVE__', 'src="lab-config.js"', 'src="main.js"'].map((s) => html.indexOf(s));
    expect(order.every((at) => at !== -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('<title>Zoma Lab</title>');
    expect(html).not.toContain('webapis.js');
    expect(renderLabIndexHtml('tizen', PROBE)).toContain('<script src="$WEBAPIS/webapis/webapis.js"></script>');
  });

  it('keeps the native probe and the config within ES2016', () => {
    expect(checkSyntax(PROBE, 'native probe')).toBeNull();
    expect(checkSyntax(labConfigScript({ server: 'http://192.168.1.20:8080', version: '0.1.0', writeMb: 200, autoRun: true }), 'lab-config.js')).toBeNull();
  });

  it('the native probe records what the engine has before any polyfill', () => {
    const window: Record<string, unknown> = {};
    runInNewContext(PROBE, { window, String, Object, Promise, Array });
    expect(window.__ZOMA_LAB_NATIVE__).toEqual({
      'String.prototype.padStart': true,
      'Object.entries': true,
      'Object.values': true,
      'Object.fromEntries': true,
      'Promise.prototype.finally': true,
      'Array.prototype.flat': true,
      'Array.prototype.includes': true,
      // The stand-in window has neither.
      globalThis: false,
      queueMicrotask: false,
    });
    // An engine without them (Chromium 53 has no padStart or flat).
    const old: Record<string, unknown> = {};
    const OldString = function () {} as unknown as StringConstructor;
    const OldArray = function () {} as unknown as ArrayConstructor;
    runInNewContext(PROBE, { window: old, String: OldString, Object: {}, Promise: undefined, Array: OldArray });
    expect(Object.values(old.__ZOMA_LAB_NATIVE__ as Record<string, boolean>).every((v) => !v)).toBe(true);
  });

  it('writes the config as window.ZOMA_LAB_CONFIG', () => {
    const window: Record<string, unknown> = {};
    runInNewContext(labConfigScript({ server: 'http://10.0.0.5:8080', version: '0.2.0', writeMb: 64, autoRun: false }), { window });
    expect(window.ZOMA_LAB_CONFIG).toEqual({ server: 'http://10.0.0.5:8080', version: '0.2.0', writeMb: 64, autoRun: false });
  });
});

describe('the lab server address', () => {
  const v4 = (address: string, internal = false): NetworkInterfaceInfo =>
    ({ address, family: 'IPv4', internal, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: null }) as NetworkInterfaceInfo;

  it('prefers a 192.168 address, then 10.x, then 172.16–31', () => {
    expect(lanAddress({ eth0: [v4('10.0.0.7'), v4('192.168.1.3')], lo: [v4('127.0.0.1', true)] })).toBe('192.168.1.3');
    expect(lanAddress({ vpn: [v4('172.20.1.4')], eth0: [v4('10.1.2.3')] })).toBe('10.1.2.3');
    expect(lanAddress({ docker: [v4('172.17.0.1')] })).toBe('172.17.0.1');
    // A host-only adapter the system marks internal is no address a TV can reach.
    expect(lanAddress({ hostOnly: [v4('192.168.56.1', true)], eth0: [v4('10.0.0.5')] })).toBe('10.0.0.5');
  });

  it('skips loopback, public and IPv6 addresses, falling back to 127.0.0.1', () => {
    const v6 = { address: 'fe80::1', family: 'IPv6', internal: false } as NetworkInterfaceInfo;
    expect(lanAddress({ lo: [v4('127.0.0.1', true)], wan: [v4('8.8.4.4'), v4('172.32.0.1')], six: [v6], none: undefined })).toBe('127.0.0.1');
  });

  it('takes http(s)://host[:port] and drops a trailing slash', () => {
    expect(checkLabServer('http://192.168.1.3:8080/')).toBe('http://192.168.1.3:8080');
    for (const bad of ['192.168.1.3:8080', 'http://h:1/path', 'ftp://h', 'http://']) expect(() => checkLabServer(bad), bad).toThrow(/--lab-server/);
  });
});
