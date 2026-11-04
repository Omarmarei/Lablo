import { describe, expect, it } from 'vitest';
import { defaultServer, labSession, readLabConfig } from './config';
import { deviceIdHash, idShape } from './spikes/s2-s3';

/** The collector's session rule (apps/mock-provider/src/lab-logs.ts). */
const SESSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

describe('the lab config', () => {
  it('takes the URL first, then the build, then the mock on this page host', () => {
    const built = { server: 'http://192.168.1.3:8080', version: '0.1.2', writeMb: 64, autoRun: true };
    expect(readLabConfig('', built, '')).toEqual({ server: 'http://192.168.1.3:8080', version: '0.1.2', writeMb: 64, autoRun: true });
    expect(readLabConfig('?server=http://127.0.0.1:9000/&mb=8&auto=0', built, '')).toEqual({ server: 'http://127.0.0.1:9000', version: '0.1.2', writeMb: 8, autoRun: false });
    expect(readLabConfig('', undefined, 'localhost')).toEqual({ server: 'http://localhost:8080', version: 'dev', writeMb: 200, autoRun: false });
    expect(readLabConfig('?auto=1', undefined, '')).toMatchObject({ server: 'http://127.0.0.1:8080', autoRun: true });
  });

  it('ignores a write target that is not a whole number of MB', () => {
    for (const mb of ['0', '-5', 'x', '2.5']) expect(readLabConfig(`?mb=${mb}`, undefined, '').writeMb).toBe(200);
  });

  it('refuses a server that is not http(s)://host[:port]', () => {
    expect(() => readLabConfig('?server=192.168.1.3:8080', undefined, '')).toThrow(/the lab server must be/);
    expect(() => readLabConfig('?server=http://h:1/path', undefined, '')).toThrow(/the lab server must be/);
  });

  it('defaults to 127.0.0.1 on file://, whose hostname is empty', () => {
    expect(defaultServer('')).toBe('http://127.0.0.1:8080');
    expect(defaultServer('10.0.0.2')).toBe('http://10.0.0.2:8080');
  });

  it('names a session the collector accepts, from the platform, model and local time', () => {
    const at = new Date(2026, 10, 4, 2, 30, 5);
    const session = labSession({ platform: 'webos', model: '43UK6300PLB' }, at, () => 0.5);
    expect(session).toBe('webos-43UK6300PLB-20261104-023005-ssss');
    const odd = labSession({ platform: 'tizen', model: '  UE43/NU7100 (Gulf) édition très longue du modèle  ' }, at, Math.random);
    expect(odd).toMatch(SESSION);
    expect(odd.startsWith('tizen-UE43-NU7100-Gulf-dition-')).toBe(true);
    expect(labSession({ platform: 'browser', model: '---' }, at, () => 0)).toBe('browser-unknown-20261104-023005-aaaa');
  });
});

describe('S3: the device ID, never sent as it is', () => {
  it('hashes the ID with a lab prefix', () => {
    expect(deviceIdHash(null)).toBeNull();
    const hash = deviceIdHash('Q3CNHKHUDLN5W');
    expect(hash).toMatch(/^[0-9a-z]+$/);
    expect(hash).not.toContain('Q3CNHKHUDLN5W'.toLowerCase());
    expect(deviceIdHash('Q3CNHKHUDLN5W')).toBe(hash);
    expect(deviceIdHash('Q3CNHKHUDLN5X')).not.toBe(hash);
  });

  it('describes its format without its value', () => {
    expect(idShape('095f142a-8f3e-4a2c-9b10-6c1d2e3f4a5b')).toEqual({ length: 36, groups: '8-4-4-4-12', classes: 'a-z 0-9 other' });
    expect(idShape('Q3CNHKHUDLN5W')).toEqual({ length: 13, groups: '13', classes: 'A-Z 0-9' });
  });
});
