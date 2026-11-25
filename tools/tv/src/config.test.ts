import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { clientName, CONFIG_FILE, DEFAULT_NAME, formatTvConfig, isPort, parseTvConfig, SDB_PORT, setupConfig, tvSerial } from './config';

describe('.tv.local.json', () => {
  it('is gitignored: it holds a LAN address and a token, and the repo is public', () => {
    const gitignore = readFileSync(path.resolve(import.meta.dirname, '../../../.gitignore'), 'utf8');
    expect(CONFIG_FILE).toBe('.tv.local.json');
    expect(gitignore.split(/\r?\n/)).toContain(CONFIG_FILE);
  });

  it('reads every field', () => {
    expect(parseTvConfig('{"host":" 10.0.0.2 ","serial":"s:1","name":"PC","token":"123","cdpPort":37201,"extra":1}')).toEqual({
      host: '10.0.0.2',
      serial: 's:1',
      name: 'PC',
      token: '123',
      cdpPort: 37_201,
    });
    expect(parseTvConfig('{"host":"tv"}')).toEqual({ host: 'tv' });
  });

  it('says what is wrong', () => {
    expect(parseTvConfig('{')).toBe('.tv.local.json is not JSON');
    expect(parseTvConfig('[]')).toBe('.tv.local.json is not an object');
    expect(parseTvConfig('null')).toBe('.tv.local.json is not an object');
    expect(parseTvConfig('"x"')).toBe('.tv.local.json is not an object');
    expect(parseTvConfig('{}')).toBe('.tv.local.json has no "host"');
    expect(parseTvConfig('{"host":"  "}')).toBe('.tv.local.json has no "host"');
    expect(parseTvConfig('{"host":5}')).toBe('.tv.local.json has no "host"');
    expect(parseTvConfig('{"host":"tv","serial":1}')).toBe('.tv.local.json: "serial" must be a string');
    expect(parseTvConfig('{"host":"tv","name":null}')).toBe('.tv.local.json: "name" must be a string');
    expect(parseTvConfig('{"host":"tv","token":12345678}')).toBe('.tv.local.json: "token" must be a string');
    for (const port of ['0', '65536', '1.5', '"9222"']) {
      expect(parseTvConfig(`{"host":"tv","cdpPort":${port}}`)).toBe('.tv.local.json: "cdpPort" must be a port number');
    }
  });

  it('knows a port number', () => {
    expect([1, 9222, 65_535].map(isPort)).toEqual([true, true, true]);
    expect([0, 65_536, 1.5, '1', null, Number.NaN].map(isPort)).toEqual([false, false, false, false, false, false]);
  });

  it("defaults sdb's serial and the client's name", () => {
    expect(SDB_PORT).toBe(26_101);
    expect(tvSerial({ host: '10.0.0.2' })).toBe('10.0.0.2:26101');
    expect(tvSerial({ host: '10.0.0.2', serial: 'emulator-26101' })).toBe('emulator-26101');
    expect(DEFAULT_NAME).toBe('LabloLabPC');
    expect(clientName({ host: 'tv' })).toBe('LabloLabPC');
    expect(clientName({ host: 'tv', name: 'Other' })).toBe('Other');
  });

  it('keeps the token and port for the same TV only', () => {
    const old = { host: '10.0.0.2', serial: 'old:1', name: 'PC', token: '123', cdpPort: 9222 };
    expect(setupConfig(old, '10.0.0.2', undefined)).toEqual(old);
    expect(setupConfig(old, '10.0.0.2', 'new:2')).toEqual({ ...old, serial: 'new:2' });
    expect(setupConfig(old, '10.0.0.3', undefined)).toEqual({ host: '10.0.0.3' });
    expect(setupConfig(old, '10.0.0.3', 'x:3')).toEqual({ host: '10.0.0.3', serial: 'x:3' });
    expect(setupConfig(null, 'tv', undefined)).toEqual({ host: 'tv' });
  });

  it('writes the file in a fixed order, leaving out what is unset', () => {
    expect(formatTvConfig({ cdpPort: 1, token: 't', host: 'tv' })).toBe('{\n  "host": "tv",\n  "token": "t",\n  "cdpPort": 1\n}\n');
    const full = { host: 'tv', serial: 's', name: 'n', token: 't', cdpPort: 2 };
    expect(parseTvConfig(formatTvConfig(full))).toEqual(full);
    expect(Object.keys(JSON.parse(formatTvConfig(full)) as object)).toEqual(['host', 'serial', 'name', 'token', 'cdpPort']);
  });
});
