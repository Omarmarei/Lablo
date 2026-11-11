// The flags that serve the step-4 scale fixtures: a JSON catalog (`--catalog`) and a static
// XMLTV file, plain or gzipped (`--xmltv`).

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixtureError, loadCatalog, loadCatalogFile } from '../src/config';
import { api, mock } from './helpers';

let dir: string;
const XML = '<?xml version="1.0" encoding="UTF-8"?>\n<tv><channel id="scale.1"><display-name>Scale 1</display-name></channel></tv>\n';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'lablo-scale-flags-'));
  writeFileSync(join(dir, 'guide.xml'), XML);
  writeFileSync(join(dir, 'guide.xml.gz'), gzipSync(XML));
  writeFileSync(
    join(dir, 'catalog.json'),
    JSON.stringify({
      live_categories: [{ id: 1, name: 'Scale' }],
      vod_categories: [{ id: 2, name: 'Scale VOD' }],
      series_categories: [],
      live: Array.from({ length: 500 }, (_, i) => ({ id: 1000 + i, name: `Scale ${i}`, category: 1, epg_id: `scale.${i}` })),
      movies: [{ id: 5000, name: 'Scale movie', category: 2, year: 2026, duration_secs: 60 }],
      series: [],
    }),
  );
  writeFileSync(join(dir, 'broken.json'), '{"live": [');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('--catalog <file.json>', () => {
  it('loads JSON catalogs with the YAML schema and serves them', async () => {
    const catalog = loadCatalogFile(join(dir, 'catalog.json'));
    expect(catalog.live).toHaveLength(500);
    expect(catalog.live[0]).toMatchObject({ id: 1000, media: 'clock', epgId: 'scale.0' });
    const app = await mock({ catalog });
    try {
      const streams = (await app.inject({ url: api('get_live_streams') })).json() as unknown[];
      expect(streams).toHaveLength(500);
      expect((await app.inject({ url: '/__mock/health' })).json()).toMatchObject({ catalog: { live: 500, movies: 1, series: 0 } });
    } finally {
      await app.close();
    }
  });

  it('reports broken JSON as a fixture error, and still reads YAML', () => {
    expect(() => loadCatalogFile(join(dir, 'broken.json'))).toThrow(FixtureError);
    expect(loadCatalogFile(join(import.meta.dirname, '..', 'fixtures', 'catalog.yaml'))).toEqual(loadCatalog());
  });
});

describe('--xmltv <file>', () => {
  for (const name of ['guide.xml', 'guide.xml.gz']) {
    it(`serves ${name} as plain XML and as gzip`, async () => {
      const app = await mock({ xmltvFile: join(dir, name) });
      try {
        for (const url of ['/xmltv.php?username=lablo&password=lablo-test', '/epg/guide.xml']) {
          const res = await app.inject({ url });
          expect(res.statusCode, url).toBe(200);
          expect(res.headers['content-type']).toBe('application/xml; charset=utf-8');
          expect(res.body).toBe(XML);
        }
        const gz = await app.inject({ url: '/epg/guide.xml.gz' });
        expect(gz.headers['content-type']).toBe('application/gzip');
        expect(gunzipSync(gz.rawPayload).toString()).toBe(XML);
        expect((await app.inject({ url: '/xmltv.php?username=lablo&password=nope' })).statusCode).toBe(401);
      } finally {
        await app.close();
      }
    });
  }
});
