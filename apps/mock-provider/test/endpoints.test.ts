// Every registered route must appear in this table and answer as listed. Adding a route
// without adding it here fails the first test, so "every endpoint is covered" stays true.
// The behaviour of each endpoint is tested in depth in the other test files.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MockServer } from '../src/server';
import { NOW_SEC, mock } from './helpers';

interface Probe {
  url: string;
  status: number;
  method?: 'GET' | 'POST' | 'PUT' | 'OPTIONS';
  payload?: string;
  contentType?: string;
}

const T = NOW_SEC - 3600;

/** Route (as Fastify registered it) -> a request that exercises it. */
const PROBES: Record<string, Probe> = {
  'GET /player_api.php': { url: '/player_api.php?username=zoma&password=zoma-test&action=get_live_streams', status: 200 },
  'POST /player_api.php': {
    method: 'POST',
    url: '/player_api.php',
    payload: 'username=zoma&password=zoma-test',
    contentType: 'application/x-www-form-urlencoded',
    status: 200,
  },
  'GET /get.php': { url: '/get.php?username=zoma&password=zoma-test&type=m3u_plus', status: 200 },
  'GET /xmltv.php': { url: '/xmltv.php?username=zoma&password=zoma-test', status: 200 },
  'GET /epg/guide.xml': { url: '/epg/guide.xml', status: 200 },
  'GET /epg/guide.xml.gz': { url: '/epg/guide.xml.gz', status: 200 },
  'GET /live/:u/:p/:file': { url: '/live/zoma/zoma-test/101.ts', status: 200 },
  'GET /:u/:p/:id(^\\d+$)': { url: '/zoma/zoma-test/101', status: 200 },
  'GET /hls/:u/:p/:id/:seg': { url: `/hls/zoma/zoma-test/101/${NOW_SEC / 6 - 1}.ts`, status: 200 },
  'GET /movie/:u/:p/:file': { url: '/movie/zoma/zoma-test/201.mp4', status: 200 },
  'GET /series/:u/:p/:file': { url: '/series/zoma/zoma-test/3001.mkv', status: 200 },
  'GET /timeshift/:u/:p/:duration/:start/:file': { url: '/timeshift/zoma/zoma-test/30/2026-11-02:10-00/101.ts', status: 200 },
  'GET /streaming/timeshift.php': {
    url: '/streaming/timeshift.php?username=zoma&password=zoma-test&stream=101&start=2026-11-02:10-00&duration=30',
    status: 200,
  },
  'GET /catchup/:u/:p/:file': { url: `/catchup/zoma/zoma-test/102.ts?start=${T}&end=${T + 600}`, status: 200 },
  'GET /flussonic/:u/:p/:id/:file': { url: `/flussonic/zoma/zoma-test/106/archive-${T}-600.ts`, status: 200 },
  'GET /images/:file': { url: '/images/movie-201.png', status: 200 },
  'GET /attribution': { url: '/attribution', status: 200 },
  'POST /__lab/logs/:session': { method: 'POST', url: '/__lab/logs/endpoints', payload: '{"ok":true}', contentType: 'application/json', status: 200 },
  'GET /__lab/logs': { url: '/__lab/logs', status: 200 },
  'GET /__lab/logs/:session': { url: '/__lab/logs/endpoints', status: 200 },
  'GET /__lab/bytes': { url: '/__lab/bytes?lines=3', status: 200 },
  'GET /__lab/echo': { url: '/__lab/echo', status: 200 },
  'GET /__lab/redirect': { url: '/__lab/redirect', status: 302 },
  'GET /__lab/source': { url: '/__lab/source', status: 200 },
  'GET /__lab/guide.xml.gz': { url: '/__lab/guide.xml.gz?days=1', status: 200 },
  'GET /__mock/redirect/:token/:n': { url: '/__mock/redirect/0000000000000000/1', status: 404 },
  'GET /__mock/health': { url: '/__mock/health', status: 200 },
  'GET /__mock/scenarios': { url: '/__mock/scenarios', status: 200 },
  'PUT /__mock/scenario': { method: 'PUT', url: '/__mock/scenario', payload: '{"name":null}', contentType: 'application/json', status: 200 },
  'GET /__mock/connections': { url: '/__mock/connections', status: 200 },
  'GET /': { url: '/', status: 200 },
  'OPTIONS *': { method: 'OPTIONS', url: '/player_api.php', status: 204 },
};

let app: MockServer;
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zoma-endpoints-'));
  app = await mock({ labLogDir: dir });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

describe('endpoint coverage', () => {
  it('has a probe for every registered route, and no stale probes', () => {
    const registered = app.mockRoutes.map((r) => `${r.method} ${r.url}`).sort();
    expect(registered).toEqual(Object.keys(PROBES).sort());
  });

  // Sequential: the lab-log GET reads what the POST wrote.
  for (const [route, probe] of Object.entries(PROBES)) {
    it(`${route} -> ${probe.status}`, async () => {
      const res = await app.inject({
        method: probe.method ?? 'GET',
        url: probe.url,
        payload: probe.payload,
        headers: probe.contentType ? { 'content-type': probe.contentType } : {},
      });
      expect(res.statusCode, res.body.slice(0, 200)).toBe(probe.status);
    });
  }

  it('lists the endpoints and test accounts on the index page', async () => {
    const res = await app.inject({ url: '/' });
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(res.body).toContain('TEST-SIGNAL server');
    expect(res.body).toContain('zoma / zoma-test  (Active, max 2)');
    expect(res.body).toContain('maxed / maxed-test  (Active, max 1)');
  });

  it('answers unknown paths with 404', async () => {
    expect((await app.inject({ url: '/panel_api.php' })).statusCode).toBe(404);
  });
});
