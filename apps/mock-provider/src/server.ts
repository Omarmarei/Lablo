// Builds the mock provider: fixtures + routes + the fault hooks.
//
// Faults run in two places:
// - preHandler: slow headers, reset before headers, redirect chains, status codes (no handler runs);
// - onSend: body transforms (BOM, CRLF, invalid UTF-8, malformed M3U, JSON quirks, truncation),
//   gzip, then stall/reset mid-body. CORS headers are added here too unless `no-cors` is set.
// `/__mock/*` and `/__lab/*` are never faulted, so a scenario can always be switched off.

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Catalog, ServerFixture } from './config';
import { DEFAULT_FIXTURES_DIR, FixtureError, loadCatalog, loadServerFixture } from './config';
import type { FaultPlan, MatchContext, Scenario } from './faults';
import {
  DEFAULT_SCENARIOS_DIR,
  gate,
  gzipBody,
  hasBodyTransforms,
  listScenarios,
  loadScenario,
  parseFaultFlags,
  planFaults,
  scenarioFaults,
  transformBody,
} from './faults';
import { DEFAULT_LAB_LOG_DIR, registerLabLogs } from './lab-logs';
import { registerLabMedia } from './lab-media';
import { NO_CORS_REQUESTS, registerLabProbes } from './lab-probes';
import { registerLabSource } from './lab-source';
import { attributionHtml } from './open-movies';
import type { MediaSource } from './media';
import { PlaceholderMedia } from './media';
import { registerPlaylist } from './playlist';
import type { MockState } from './state';
import { ConnectionTracker, baseUrl, requestParams } from './state';
import { registerStreams } from './streams';
import { registerSubtitleFiles } from './subtitle-files';
import { registerXmltv } from './xmltv';
import { registerXtream } from './xtream';

export interface MockServerOptions {
  /** Folder with server.yaml, catalog.yaml and scenarios/ (default: the package's fixtures/). */
  fixturesDir?: string;
  fixture?: ServerFixture;
  catalog?: Catalog;
  /** Scenario name (in scenarios/), YAML path, parsed scenario, or null for none. */
  scenario?: string | Scenario | null;
  scenariosDir?: string;
  /** Clock in epoch ms (tests pin it). */
  now?: () => number;
  media?: MediaSource;
  /** Serve this XMLTV file (.xml or .xml.gz) instead of the generated guide (scale fixtures). */
  xmltvFile?: string;
  /** Lab log folder; `null` disables the collector (e.g. on a public server). */
  labLogDir?: string | null;
  /** Print one line per request. */
  logRequests?: boolean;
}

export interface MockServer extends FastifyInstance {
  mockState: MockState;
  /** Every registered route except automatic HEAD routes (the endpoint coverage test uses it). */
  mockRoutes: { method: string; url: string }[];
}

const TEXT = 'text/plain; charset=utf-8';
const EXPOSE_HEADERS = 'content-length, content-range, accept-ranges, etag, x-mock-archive-channel, x-mock-archive-start, x-mock-archive-duration, x-lab-lines';
const UNFAULTED = /^\/__(mock|lab)(\/|$)/;
const MAX_REDIRECT_CHAINS = 1000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function streamIdOf(request: FastifyRequest, params: Record<string, string>): number | undefined {
  const route = (request.params ?? {}) as Record<string, string | undefined>;
  const candidates = [route['id'], /^\d+/.exec(route['file'] ?? '')?.[0], params['stream_id'], params['stream'], params['vod_id'], params['series_id']];
  for (const c of candidates) {
    if (c !== undefined && /^\d+$/.test(c)) return Number(c);
  }
  return undefined;
}

export async function buildServer(options: MockServerOptions = {}): Promise<MockServer> {
  const fixturesDir = options.fixturesDir ?? DEFAULT_FIXTURES_DIR;
  const scenariosDir = options.scenariosDir ?? (options.fixturesDir ? join(fixturesDir, 'scenarios') : DEFAULT_SCENARIOS_DIR);
  const scenario =
    options.scenario === undefined || options.scenario === null
      ? null
      : typeof options.scenario === 'string'
        ? loadScenario(options.scenario, scenariosDir)
        : options.scenario;

  const state: MockState = {
    fixture: options.fixture ?? loadServerFixture(fixturesDir),
    catalog: options.catalog ?? loadCatalog(fixturesDir),
    media: options.media ?? new PlaceholderMedia(),
    now: options.now ?? Date.now,
    scenario,
    scenariosDir,
    connections: new ConnectionTracker(),
    xmltvFile: options.xmltvFile ?? null,
  };

  const app = Fastify({
    logger: false,
    // Stalled responses hold sockets open on purpose; close() must still end them.
    forceCloseConnections: true,
    routerOptions: { maxParamLength: 500, ignoreTrailingSlash: true },
  });
  app.decorateRequest('mock', null);
  app.decorate('mockState', state);
  const routes: { method: string; url: string }[] = [];
  app.decorate('mockRoutes', routes);
  app.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) if (method !== 'HEAD') routes.push({ method, url: route.url });
  });

  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  // Redirect chains: tokens map to the final location, so the hop route is not an open redirect.
  const chains = new Map<string, { location: string; status: number }>();

  const preFaults = async (request: FastifyRequest, reply: FastifyReply, plan: FaultPlan, params: Record<string, string>): Promise<void> => {
    if (plan.slowHeaders) await sleep(plan.slowHeaders.delayMs);
    if (plan.reset && plan.reset.afterBytes === undefined) {
      reply.hijack();
      request.raw.socket.destroy();
      return;
    }
    if (plan.redirect && params['mock_hop'] === undefined) {
      const { hops, status, host, relative } = plan.redirect;
      const path = `${request.url}${request.url.includes('?') ? '&' : '?'}mock_hop=done`;
      const origin = relative ? '' : `http://${host ?? request.host}`;
      const final = `${origin}${path}`;
      if (hops === 1) {
        void reply.code(status).header('location', final).send();
        return;
      }
      const token = randomBytes(8).toString('hex');
      chains.set(token, { location: final, status });
      if (chains.size > MAX_REDIRECT_CHAINS) chains.delete(chains.keys().next().value as string);
      void reply.code(status).header('location', `${origin}/__mock/redirect/${token}/${hops - 1}`).send();
      return;
    }
    if (plan.status) {
      const { status, body, contentType } = plan.status;
      const defaults: Record<number, string> = { 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 509: 'Bandwidth Limit Exceeded' };
      void reply.code(status).type(contentType).send(body ?? defaults[status] ?? `Mock status ${status}`);
    }
  };

  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '/';
    if (request.method === 'OPTIONS' || UNFAULTED.test(path)) return;
    const params = requestParams(request);
    const route = (request.params ?? {}) as Record<string, string | undefined>;
    const ctx: MatchContext = {
      path,
      method: request.method,
      params,
      username: route['u'] ?? params['username'],
      streamId: streamIdOf(request, params),
    };
    let flags;
    try {
      flags = params['mock_fault'] ? parseFaultFlags(params['mock_fault']) : [];
    } catch (error) {
      if (error instanceof FixtureError) return reply.code(400).type(TEXT).send(error.message);
      throw error;
    }
    const plan = planFaults([...scenarioFaults(state.scenario, ctx), ...flags]);
    request.mock = {
      plan,
      tz: plan.timezone?.tz ?? state.fixture.server.timezone,
      xmltv: plan.timezone?.xmltv ?? 'utc',
    };
    await preFaults(request, reply, plan, params);
    return undefined;
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const plan = request.mock?.plan;
    if (!plan?.noCors && !NO_CORS_REQUESTS.has(request)) {
      void reply.header('access-control-allow-origin', '*').header('access-control-expose-headers', EXPOSE_HEADERS);
    }
    if (!plan || request.method === 'HEAD' || payload === null || payload === undefined) return payload;
    let body = payload as string | Buffer | Readable;
    if (hasBodyTransforms(plan) && (typeof body === 'string' || Buffer.isBuffer(body))) {
      body = transformBody(Buffer.from(body), String(reply.getHeader('content-type') ?? ''), plan);
    }
    if (plan.gzip) {
      body = gzipBody(typeof body === 'string' ? Buffer.from(body) : body);
      if (plan.gzip.mode === 'encoding') void reply.header('content-encoding', 'gzip');
      else void reply.type('application/gzip');
      if (!Buffer.isBuffer(body)) reply.removeHeader('content-length');
    }
    const cut = plan.stall ?? (plan.reset?.afterBytes !== undefined ? plan.reset : undefined);
    if (cut) {
      if (typeof body === 'string') body = Buffer.from(body);
      // Declare the full length, then stop short: the client knows more was promised.
      if (Buffer.isBuffer(body)) void reply.header('content-length', String(body.length));
      const res = reply.raw;
      body = gate(body, {
        afterBytes: cut.afterBytes,
        afterMs: cut.type === 'stall' ? cut.afterMs : undefined,
        onTrigger: () => {
          setImmediate(() => {
            if (!res.destroyed) res.flushHeaders();
          });
          if (cut.type === 'stall') {
            const timer = setTimeout(() => res.socket?.destroy(), cut.holdMs);
            timer.unref();
            res.once('close', () => clearTimeout(timer));
          } else {
            // Give the bytes already written a moment to leave, then drop the connection.
            setTimeout(() => res.socket?.destroy(), 50).unref();
          }
        },
      });
    }
    return body;
  });

  if (options.logRequests) {
    app.addHook('onResponse', async (request, reply) => {
      console.log(`${request.method} ${request.url} -> ${reply.statusCode} (${Math.round(reply.elapsedTime)} ms)`);
    });
  }

  // CORS preflight for the desktop dev loop (TV apps are not subject to CORS).
  app.options('*', async (request, reply) => {
    return reply
      .code(204)
      .header('access-control-allow-methods', 'GET, HEAD, POST, PUT, OPTIONS')
      .header('access-control-allow-headers', request.headers['access-control-request-headers'] ?? 'content-type, range')
      .header('access-control-max-age', '600')
      .send();
  });

  registerXtream(app, state);
  registerPlaylist(app, state);
  registerXmltv(app, state);
  registerStreams(app, state);
  registerSubtitleFiles(app, state);
  if (options.labLogDir !== null) registerLabLogs(app, options.labLogDir ?? DEFAULT_LAB_LOG_DIR);
  // The lab's probes and its scale source store nothing, so they stay on with the collector off.
  registerLabProbes(app);
  registerLabSource(app, state);
  registerLabMedia(app, state);

  // ---- Control endpoints --------------------------------------------------------------------
  app.get<{ Params: { token: string; n: string } }>('/__mock/redirect/:token/:n', async (request, reply) => {
    const chain = chains.get(request.params.token);
    const n = Number(request.params.n);
    if (!chain || !Number.isInteger(n) || n < 1) return reply.code(404).type(TEXT).send('Unknown redirect chain');
    const origin = /^https?:\/\//.test(chain.location) ? baseUrl(request) : '';
    const location = n === 1 ? chain.location : `${origin}/__mock/redirect/${request.params.token}/${n - 1}`;
    return reply.code(chain.status).header('location', location).send();
  });

  app.get('/__mock/health', async () => ({
    ok: true,
    scenario: state.scenario?.name ?? null,
    now: new Date(state.now()).toISOString(),
    media: state.media.kind,
    catalog: { live: state.catalog.live.length, movies: state.catalog.movies.length, series: state.catalog.series.length },
  }));

  // Credits for the Blender open movies (CC BY) and a note on the generated test media.
  app.get('/attribution', async (_request, reply) => reply.type('text/html; charset=utf-8').send(attributionHtml()));

  app.get('/__mock/scenarios', async () => ({ active: state.scenario?.name ?? null, available: listScenarios(state.scenariosDir) }));

  app.put<{ Body: { name?: string | null } | undefined }>('/__mock/scenario', async (request, reply) => {
    const name = request.body?.name ?? null;
    if (name === null || name === '') {
      state.scenario = null;
      return { active: null };
    }
    try {
      // Loading afresh also resets the rules' hit counters.
      state.scenario = loadScenario(name, state.scenariosDir);
    } catch (error) {
      if (error instanceof FixtureError) return reply.code(404).type(TEXT).send(error.message);
      throw error;
    }
    return { active: state.scenario.name, rules: state.scenario.rules.length };
  });

  app.get('/__mock/connections', async () => state.connections.snapshot());

  app.get('/', async (request, reply) => {
    const base = baseUrl(request);
    const accounts = state.fixture.accounts.map((a) => `  ${a.username} / ${a.password}  (${a.status}, max ${a.maxConnections})`);
    return reply.type(TEXT).send(
      [
        'Zoma mock provider: a TEST-SIGNAL server for Zoma IPTV development. It carries no real channels.',
        '',
        `Xtream:   ${base}/player_api.php?username=U&password=P[&action=...]`,
        `M3U:      ${base}/get.php?username=U&password=P&type=m3u_plus&output=ts`,
        `XMLTV:    ${base}/xmltv.php?username=U&password=P   (also ${base}/epg/guide.xml[.gz])`,
        `Faults:   ?mock_fault=status:509 | redirect:hops=3 | stall:after_bytes=4096 | ...   scenario: ${state.scenario?.name ?? 'none'}`,
        `Lab logs: POST ${base}/__lab/logs/<session>   GET ${base}/__lab/logs`,
        `Lab:      ${base}/__lab/bytes?lines=N   ${base}/__lab/echo?cors=0   ${base}/__lab/redirect?to=/__lab/echo`,
        `Lab:      ${base}/__lab/source   ${base}/__lab/media   (the S6 source and the player batteries' media)`,
        `Subtitles: ${base}/subtitles/U/P/<id>.<eng|ara>.<srt|vtt>[?charset=windows-1256]   (beside a film or an episode)`,
        `Media:    ${state.media.kind}   Credits: ${base}/attribution`,
        '',
        'Test accounts (fixtures/server.yaml):',
        ...accounts,
        '',
      ].join('\n'),
    );
  });

  app.setNotFoundHandler(async (_request, reply) => reply.code(404).type(TEXT).send('Not found'));

  return app as unknown as MockServer;
}
