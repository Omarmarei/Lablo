/**
 * The protocol's shared samples (RELAY step 29b2a): inputs for every schema with the verdict
 * each must get, as `code@path` per issue (none: valid) and, where parsing changes the value
 * (unknown fields dropped), the output. `checkSamples` runs them in Node (the unit tests) and
 * in the old engines (the vectors page, in a page and in a Blob worker), so zod's parsing is
 * held to the same answers on Chromium 53, 56 and 68 as in Node.
 *
 * ASCII only (non-ASCII text is built from char codes).
 */
import { BACKUP_CT_MAX_CHARS } from './backup';
import { PAIR_CT_MAX_CHARS } from './pairing';

export type SampleSchema =
  | 'configDoc'
  | 'configResponse'
  | 'pairCreateRequest'
  | 'pairCreateResponse'
  | 'pairTvKeyResponse'
  | 'sealedPayload'
  | 'pairUploadRequest'
  | 'pairUploadResponse'
  | 'pairPollResponse'
  | 'pairStatusRequest'
  | 'pairProgressResponse'
  | 'pairFileUrlResponse'
  | 'pairPayload'
  | 'backupEnvelope'
  | 'lookupId'
  | 'telemetryBatch'
  | 'telemetryEvent';

export interface ProtocolSample {
  readonly name: string;
  readonly schema: SampleSchema;
  readonly input: unknown;
  /** Every issue zod reports, as `code@path` in its order; empty when the input is valid. */
  readonly issues: readonly string[];
  /** The parsed value when it differs from the input. */
  readonly output?: unknown;
}

/** A valid base64url string of 32, 24, 16 or 64 bytes. */
const KEY = `${'x'.repeat(42)}w`;
const KEY_2 = `${'Ab-_'.repeat(10)}AbE`;
const NONCE = 'n'.repeat(32);
const ID = `${'k'.repeat(21)}g`;
const SIG = `${'s'.repeat(85)}Q`;
/** 16 bytes (the shortest ciphertext), 17 bytes, 18 bytes. */
const CT_16 = `${'c'.repeat(21)}w`;
const CT_17 = `${'c'.repeat(22)}A`;
const CT_18 = 'c'.repeat(24);
const T0 = 1795000000000;
const T1 = T0 + 86400000;
/** "Please update" in Arabic. */
const AR = String.fromCharCode(0x064a, 0x0631, 0x062c, 0x0649, 0x0020, 0x0627, 0x0644, 0x062a, 0x062d, 0x062f, 0x064a, 0x062b);

const configMinimal = {
  v: 1,
  issuedAt: T0,
  expiresAt: T1,
  minVersion: {},
  kill: [],
  blocklist: { salt: 'salt-of-sixteen-', hashes: [] },
  flags: {},
  tunables: {},
};

const killRule = {
  id: 'old-player-bug',
  match: { platform: 'webos', versions: { min: '1.0.0', max: '1.2.3' }, countries: ['AE', 'SA'] },
  mode: 'notice',
  message: { en: 'Please update the app.', ar: AR },
};

const configFull = {
  v: 1,
  issuedAt: T0,
  expiresAt: T1,
  minVersion: { tizen: '1.0.0', webos: '1.1.0' },
  kill: [killRule, { id: 'all-off', match: {}, mode: 'disable-app' }],
  blocklist: { salt: 'Zx9-salt_0123456789', hashes: [KEY, KEY_2] },
  flags: { parental: true, radio: false },
  tunables: {
    liveBufferSeconds: 2.5,
    vodBufferSeconds: 10,
    openTimeoutMs: 15000,
    stallTimeoutMs: 8000,
    epgDaysBack: 2,
    epgDaysAhead: 7,
    telemetrySampling: { play_result: 0.1, crash: 1 },
  },
};

const sealed = { phonePk: KEY, nonce: NONCE, ct: CT_18 };
const file = { key: ID, fileKey: KEY, base: NONCE, size: 1048577 };
const event = { kind: 'stall', at: T0, recovered: true, attempts: 2 };

const config = (changes: Record<string, unknown>): Record<string, unknown> => ({ ...configMinimal, ...changes });
const withKill = (changes: Record<string, unknown>): Record<string, unknown> => config({ kill: [{ ...killRule, ...changes }] });

export const SAMPLES: readonly ProtocolSample[] = [
  // The config doc (architecture.md §3.3 C).
  { name: 'config.minimal', schema: 'configDoc', input: configMinimal, issues: [] },
  { name: 'config.full', schema: 'configDoc', input: configFull, issues: [] },
  { name: 'config.unknown-fields-dropped', schema: 'configDoc', input: config({ later: { x: 1 }, tunables: { later: 5 } }), issues: [], output: configMinimal },
  { name: 'config.not-an-object', schema: 'configDoc', input: null, issues: ['invalid_type@'] },
  { name: 'config.version-2', schema: 'configDoc', input: config({ v: 2 }), issues: ['invalid_value@v'] },
  { name: 'config.expires-before-issued', schema: 'configDoc', input: config({ expiresAt: T0 }), issues: ['custom@expiresAt'] },
  { name: 'config.time-not-integer', schema: 'configDoc', input: config({ issuedAt: T0 + 0.5 }), issues: ['invalid_type@issuedAt'] },
  { name: 'config.time-negative', schema: 'configDoc', input: config({ issuedAt: -1 }), issues: ['too_small@issuedAt'] },
  { name: 'config.min-version-short', schema: 'configDoc', input: config({ minVersion: { tizen: '1.2' } }), issues: ['invalid_format@minVersion.tizen'] },
  { name: 'config.kill-mode-unknown', schema: 'configDoc', input: withKill({ mode: 'self-destruct' }), issues: ['invalid_value@kill.0.mode'] },
  { name: 'config.kill-id-upper', schema: 'configDoc', input: withKill({ id: 'Old' }), issues: ['invalid_format@kill.0.id'] },
  { name: 'config.kill-country-lower', schema: 'configDoc', input: withKill({ match: { countries: ['ae'] } }), issues: ['invalid_format@kill.0.match.countries.0'] },
  { name: 'config.kill-countries-empty', schema: 'configDoc', input: withKill({ match: { countries: [] } }), issues: ['too_small@kill.0.match.countries'] },
  { name: 'config.kill-platform-unknown', schema: 'configDoc', input: withKill({ match: { platform: 'android' } }), issues: ['invalid_value@kill.0.match.platform'] },
  { name: 'config.kill-message-no-ar', schema: 'configDoc', input: withKill({ message: { en: 'Update.' } }), issues: ['invalid_type@kill.0.message.ar'] },
  { name: 'config.kill-message-blank', schema: 'configDoc', input: withKill({ message: { en: '   ', ar: AR } }), issues: ['invalid_format@kill.0.message.en'] },
  { name: 'config.blocklist-salt-short', schema: 'configDoc', input: config({ blocklist: { salt: 'short', hashes: [] } }), issues: ['invalid_format@blocklist.salt'] },
  { name: 'config.blocklist-hash-unused-bits', schema: 'configDoc', input: config({ blocklist: { salt: 'salt-of-sixteen-', hashes: [`${'x'.repeat(42)}x`] } }), issues: ['invalid_format@blocklist.hashes.0'] },
  { name: 'config.blocklist-hash-padded', schema: 'configDoc', input: config({ blocklist: { salt: 'salt-of-sixteen-', hashes: [`${KEY}=`] } }), issues: ['invalid_format@blocklist.hashes.0'] },
  { name: 'config.flag-not-boolean', schema: 'configDoc', input: config({ flags: { radio: 1 } }), issues: ['invalid_type@flags.radio'] },
  { name: 'config.flag-key-upper', schema: 'configDoc', input: config({ flags: { Radio: true } }), issues: ['invalid_key@flags.Radio'] },
  { name: 'config.tunable-too-big', schema: 'configDoc', input: config({ tunables: { liveBufferSeconds: 61 } }), issues: ['too_big@tunables.liveBufferSeconds'] },
  { name: 'config.sampling-over-one', schema: 'configDoc', input: config({ tunables: { telemetrySampling: { crash: 1.5 } } }), issues: ['too_big@tunables.telemetrySampling.crash'] },
  {
    name: 'config.two-issues',
    schema: 'configDoc',
    input: config({ v: 2, flags: { radio: 'yes' } }),
    issues: ['invalid_value@v', 'invalid_type@flags.radio'],
  },
  { name: 'configResponse.valid', schema: 'configResponse', input: { doc: '{"v":1}', sig: SIG, country: 'AE' }, issues: [] },
  { name: 'configResponse.no-country', schema: 'configResponse', input: { doc: '{"v":1}', sig: SIG, country: null }, issues: [] },
  { name: 'configResponse.country-missing', schema: 'configResponse', input: { doc: '{"v":1}', sig: SIG }, issues: ['invalid_type@country'] },
  { name: 'configResponse.sig-short', schema: 'configResponse', input: { doc: '{"v":1}', sig: KEY, country: 'AE' }, issues: ['invalid_format@sig'] },

  // Pairing (architecture.md §3.2, §3.3 A).
  { name: 'pair.create', schema: 'pairCreateRequest', input: { tvPk: KEY }, issues: [] },
  { name: 'pair.create-key-padded', schema: 'pairCreateRequest', input: { tvPk: `${KEY}=` }, issues: ['invalid_format@tvPk'] },
  { name: 'pair.create-key-plus', schema: 'pairCreateRequest', input: { tvPk: `+${KEY.slice(1)}` }, issues: ['invalid_format@tvPk'] },
  { name: 'pair.create-check', schema: 'pairCreateRequest', input: { tvPk: KEY, purpose: 'check' }, issues: [] },
  { name: 'pair.create-add', schema: 'pairCreateRequest', input: { tvPk: KEY, purpose: 'add' }, issues: [] },
  { name: 'pair.create-purpose-unknown', schema: 'pairCreateRequest', input: { tvPk: KEY, purpose: 'reset' }, issues: ['invalid_value@purpose'] },
  { name: 'pair.created', schema: 'pairCreateResponse', input: { sid: ID, code: '7K3M9QZT', pollToken: KEY_2, exp: T1 }, issues: [] },
  { name: 'pair.created-code-with-i', schema: 'pairCreateResponse', input: { sid: ID, code: '7K3M9QZI', pollToken: KEY_2, exp: T1 }, issues: ['invalid_format@code'] },
  { name: 'pair.created-code-lower', schema: 'pairCreateResponse', input: { sid: ID, code: '7k3m9qzt', pollToken: KEY_2, exp: T1 }, issues: ['invalid_format@code'] },
  { name: 'pair.created-code-short', schema: 'pairCreateResponse', input: { sid: ID, code: '7K3M9QZ', pollToken: KEY_2, exp: T1 }, issues: ['invalid_format@code'] },
  { name: 'pair.tv-key', schema: 'pairTvKeyResponse', input: { tvPk: KEY, exp: T1, purpose: 'add' }, issues: [] },
  { name: 'pair.tv-key-check', schema: 'pairTvKeyResponse', input: { tvPk: KEY, exp: T1, purpose: 'check' }, issues: [] },
  { name: 'pair.tv-key-no-exp', schema: 'pairTvKeyResponse', input: { tvPk: KEY, purpose: 'add' }, issues: ['invalid_type@exp'] },
  { name: 'pair.tv-key-no-purpose', schema: 'pairTvKeyResponse', input: { tvPk: KEY, exp: T1 }, issues: ['invalid_value@purpose'] },
  { name: 'pair.sealed', schema: 'sealedPayload', input: sealed, issues: [] },
  { name: 'pair.sealed-ct-16', schema: 'sealedPayload', input: { ...sealed, ct: CT_16 }, issues: [] },
  { name: 'pair.sealed-ct-17', schema: 'sealedPayload', input: { ...sealed, ct: CT_17 }, issues: [] },
  { name: 'pair.sealed-ct-15', schema: 'sealedPayload', input: { ...sealed, ct: 'c'.repeat(20) }, issues: ['too_small@ct'] },
  { name: 'pair.sealed-ct-4k-plus-1', schema: 'sealedPayload', input: { ...sealed, ct: 'c'.repeat(25) }, issues: ['invalid_format@ct'] },
  { name: 'pair.sealed-ct-unused-bits', schema: 'sealedPayload', input: { ...sealed, ct: `${'c'.repeat(22)}d` }, issues: ['invalid_format@ct'] },
  { name: 'pair.sealed-ct-longest', schema: 'sealedPayload', input: { ...sealed, ct: 'c'.repeat(PAIR_CT_MAX_CHARS - (PAIR_CT_MAX_CHARS % 4)) }, issues: [] },
  { name: 'pair.sealed-ct-too-long', schema: 'sealedPayload', input: { ...sealed, ct: 'c'.repeat(PAIR_CT_MAX_CHARS + 4 - (PAIR_CT_MAX_CHARS % 4)) }, issues: ['too_big@ct'] },
  { name: 'pair.sealed-nonce-short', schema: 'sealedPayload', input: { ...sealed, nonce: 'n'.repeat(31) }, issues: ['invalid_format@nonce'] },
  { name: 'pair.upload', schema: 'pairUploadRequest', input: { size: 41943040 }, issues: [] },
  { name: 'pair.upload-too-big', schema: 'pairUploadRequest', input: { size: 41943041 }, issues: ['too_big@size'] },
  { name: 'pair.upload-too-small', schema: 'pairUploadRequest', input: { size: 15 }, issues: ['too_small@size'] },
  { name: 'pair.upload-fraction', schema: 'pairUploadRequest', input: { size: 100.5 }, issues: ['invalid_type@size'] },
  { name: 'pair.upload-url', schema: 'pairUploadResponse', input: { url: 'https://r2.example/b/k?X-Amz-Signature=ab', key: ID, exp: T1 }, issues: [] },
  { name: 'pair.upload-url-http', schema: 'pairUploadResponse', input: { url: 'http://r2.example/b/k', key: ID, exp: T1 }, issues: ['invalid_format@url'] },
  { name: 'pair.upload-url-dev-path', schema: 'pairUploadResponse', input: { url: `/dev/blob/pair/${ID}/${ID}?m=PUT&n=48&e=1767225600000&s=a_b-C`, key: ID, exp: T1 }, issues: [] },
  { name: 'pair.upload-url-other-path', schema: 'pairUploadResponse', input: { url: `/v1/blob/pair/${ID}?m=PUT`, key: ID, exp: T1 }, issues: ['invalid_format@url'] },
  { name: 'pair.upload-url-dev-host', schema: 'pairUploadResponse', input: { url: '/dev/blob//evilhost/k?m=PUT', key: ID, exp: T1 }, issues: ['invalid_format@url'] },
  { name: 'pair.upload-url-protocol-relative', schema: 'pairUploadResponse', input: { url: '//evil.example/dev/blob/k?m=PUT', key: ID, exp: T1 }, issues: ['invalid_format@url'] },
  { name: 'pair.upload-url-dev-dots', schema: 'pairUploadResponse', input: { url: '/dev/blob/../v1/pair?m=PUT', key: ID, exp: T1 }, issues: ['invalid_format@url'] },
  { name: 'pair.upload-url-dev-no-query', schema: 'pairUploadResponse', input: { url: '/dev/blob/pair/k', key: ID, exp: T1 }, issues: ['invalid_format@url'] },
  { name: 'pair.upload-url-dev-escaped', schema: 'pairUploadResponse', input: { url: '/dev/blob/pair/k?m=PUT&s=%2F', key: ID, exp: T1 }, issues: ['invalid_format@url'] },
  { name: 'pair.poll-waiting', schema: 'pairPollResponse', input: { state: 'waiting', exp: T1 }, issues: [] },
  { name: 'pair.poll-ready', schema: 'pairPollResponse', input: { state: 'ready', payload: sealed }, issues: [] },
  { name: 'pair.poll-ready-bad-payload', schema: 'pairPollResponse', input: { state: 'ready', payload: { ...sealed, phonePk: ID } }, issues: ['invalid_format@payload.phonePk'] },
  { name: 'pair.poll-unknown-state', schema: 'pairPollResponse', input: { state: 'gone' }, issues: ['invalid_union@state'] },
  { name: 'pair.status', schema: 'pairStatusRequest', input: { status: 'auth_failed' }, issues: [] },
  { name: 'pair.status-unknown', schema: 'pairStatusRequest', input: { status: 'failed' }, issues: ['invalid_value@status'] },
  { name: 'pair.status-match', schema: 'pairStatusRequest', input: { status: 'match' }, issues: [] },
  { name: 'pair.status-no-match', schema: 'pairStatusRequest', input: { status: 'no_match' }, issues: [] },
  { name: 'pair.progress-open', schema: 'pairProgressResponse', input: { state: 'open', exp: T1 }, issues: [] },
  { name: 'pair.progress-open-no-exp', schema: 'pairProgressResponse', input: { state: 'open' }, issues: ['invalid_type@exp'] },
  { name: 'pair.progress-sent', schema: 'pairProgressResponse', input: { state: 'sent' }, issues: [] },
  { name: 'pair.progress-received', schema: 'pairProgressResponse', input: { state: 'received', exp: T1 }, issues: [], output: { state: 'received' } },
  { name: 'pair.progress-done', schema: 'pairProgressResponse', input: { state: 'done', status: 'blocked' }, issues: [] },
  { name: 'pair.progress-done-no-match', schema: 'pairProgressResponse', input: { state: 'done', status: 'no_match' }, issues: [] },
  { name: 'pair.progress-done-no-status', schema: 'pairProgressResponse', input: { state: 'done' }, issues: ['invalid_value@status'] },
  { name: 'pair.progress-done-unknown-status', schema: 'pairProgressResponse', input: { state: 'done', status: 'failed' }, issues: ['invalid_value@status'] },
  { name: 'pair.progress-unknown-state', schema: 'pairProgressResponse', input: { state: 'ready' }, issues: ['invalid_union@state'] },
  { name: 'pair.file-url', schema: 'pairFileUrlResponse', input: { url: 'https://r2.example/b/k?X-Amz-Signature=cd', key: ID, exp: T1 }, issues: [] },
  { name: 'pair.file-url-http', schema: 'pairFileUrlResponse', input: { url: 'http://r2.example/b/k', key: ID, exp: T1 }, issues: ['invalid_format@url'] },
  { name: 'pair.file-url-dev-path', schema: 'pairFileUrlResponse', input: { url: `/dev/blob/pair/${ID}/${ID}?m=GET&n=&e=1767225600000&s=x`, key: ID, exp: T1 }, issues: [] },
  { name: 'pair.file-url-no-key', schema: 'pairFileUrlResponse', input: { url: 'https://r2.example/b/k', exp: T1 }, issues: ['invalid_type@key'] },
  {
    name: 'pair.payload-xtream',
    schema: 'pairPayload',
    input: { v: 1, source: { type: 'xtream', server: 'http://panel.example:8080', username: 'user1', password: 'p@ss word' }, name: 'Home', epg: ['https://epg.example/guide.xml.gz'] },
    issues: [],
  },
  { name: 'pair.payload-m3u', schema: 'pairPayload', input: { v: 1, source: { type: 'm3u', url: 'HTTPS://list.example/get.php?a=1&b=2' } }, issues: [] },
  { name: 'pair.payload-file', schema: 'pairPayload', input: { v: 1, source: { type: 'm3u-file', file } }, issues: [] },
  {
    name: 'pair.payload-unknown-fields-dropped',
    schema: 'pairPayload',
    input: { v: 1, source: { type: 'm3u', url: 'http://a.example/l.m3u', later: 1 }, later: true },
    issues: [],
    output: { v: 1, source: { type: 'm3u', url: 'http://a.example/l.m3u' } },
  },
  { name: 'pair.payload-version-2', schema: 'pairPayload', input: { v: 2, source: { type: 'm3u', url: 'http://a.example/l.m3u' } }, issues: ['invalid_value@v'] },
  { name: 'pair.payload-type-unknown', schema: 'pairPayload', input: { v: 1, source: { type: 'stalker', url: 'http://a.example/' } }, issues: ['invalid_union@source.type'] },
  { name: 'pair.payload-password-blank', schema: 'pairPayload', input: { v: 1, source: { type: 'xtream', server: 'http://p.example', username: 'u', password: '  ' } }, issues: ['invalid_format@source.password'] },
  { name: 'pair.payload-ftp', schema: 'pairPayload', input: { v: 1, source: { type: 'm3u', url: 'ftp://a.example/l.m3u' } }, issues: ['invalid_format@source.url'] },
  { name: 'pair.payload-link-space', schema: 'pairPayload', input: { v: 1, source: { type: 'm3u', url: 'http://a.example/my list.m3u' } }, issues: ['invalid_format@source.url'] },
  {
    name: 'pair.payload-five-epg',
    schema: 'pairPayload',
    input: { v: 1, source: { type: 'm3u', url: 'http://a.example/l.m3u' }, epg: ['http://e/1', 'http://e/2', 'http://e/3', 'http://e/4', 'http://e/5'] },
    issues: ['too_big@epg'],
  },
  { name: 'pair.payload-file-empty', schema: 'pairPayload', input: { v: 1, source: { type: 'm3u-file', file: { ...file, size: 0 } } }, issues: ['too_small@source.file.size'] },
  { name: 'pair.payload-file-key-short', schema: 'pairPayload', input: { v: 1, source: { type: 'm3u-file', file: { ...file, fileKey: ID } } }, issues: ['invalid_format@source.file.fileKey'] },

  // The backup (architecture.md §3.2, §3.3 B).
  { name: 'backup.envelope', schema: 'backupEnvelope', input: { v: 1, kdf: 'scrypt-15-8-1', nonce: NONCE, ct: CT_17 }, issues: [] },
  { name: 'backup.envelope-longest', schema: 'backupEnvelope', input: { v: 1, kdf: 'scrypt-15-8-1', nonce: NONCE, ct: 'c'.repeat(BACKUP_CT_MAX_CHARS - (BACKUP_CT_MAX_CHARS % 4)) }, issues: [] },
  {
    name: 'backup.envelope-too-long',
    schema: 'backupEnvelope',
    input: { v: 1, kdf: 'scrypt-15-8-1', nonce: NONCE, ct: 'c'.repeat(BACKUP_CT_MAX_CHARS + 4 - (BACKUP_CT_MAX_CHARS % 4)) },
    issues: ['too_big@ct'],
  },
  { name: 'backup.envelope-kdf', schema: 'backupEnvelope', input: { v: 1, kdf: 'scrypt-14-8-1', nonce: NONCE, ct: CT_17 }, issues: ['invalid_value@kdf'] },
  { name: 'backup.envelope-version', schema: 'backupEnvelope', input: { v: '1', kdf: 'scrypt-15-8-1', nonce: NONCE, ct: CT_17 }, issues: ['invalid_value@v'] },
  { name: 'backup.envelope-nonce-short', schema: 'backupEnvelope', input: { v: 1, kdf: 'scrypt-15-8-1', nonce: 'n'.repeat(31), ct: CT_17 }, issues: ['invalid_format@nonce'] },
  { name: 'backup.envelope-no-ct', schema: 'backupEnvelope', input: { v: 1, kdf: 'scrypt-15-8-1', nonce: NONCE }, issues: ['invalid_type@ct'] },
  { name: 'backup.lookup-id', schema: 'lookupId', input: KEY_2, issues: [] },
  { name: 'backup.lookup-id-31', schema: 'lookupId', input: `${'x'.repeat(41)}A`, issues: ['invalid_format@'] },

  // Telemetry (architecture.md §3.4).
  { name: 'telemetry.batch', schema: 'telemetryBatch', input: { installId: ID, platform: 'tizen', appVersion: '1.0.12', events: [event, { kind: 'later' }] }, issues: [] },
  { name: 'telemetry.batch-empty', schema: 'telemetryBatch', input: { installId: ID, platform: 'tizen', appVersion: '1.0.12', events: [] }, issues: ['too_small@events'] },
  { name: 'telemetry.batch-platform', schema: 'telemetryBatch', input: { installId: ID, platform: 'android', appVersion: '1.0.12', events: [event] }, issues: ['invalid_value@platform'] },
  { name: 'telemetry.batch-version', schema: 'telemetryBatch', input: { installId: ID, platform: 'webos', appVersion: '1.0', events: [event] }, issues: ['invalid_format@appVersion'] },
  { name: 'telemetry.batch-version-long', schema: 'telemetryBatch', input: { installId: ID, platform: 'webos', appVersion: '1234.0.0', events: [event] }, issues: ['invalid_format@appVersion'] },
  { name: 'telemetry.batch-install-id', schema: 'telemetryBatch', input: { installId: KEY, platform: 'webos', appVersion: '1.0.0', events: [event] }, issues: ['invalid_format@installId'] },
  { name: 'telemetry.app-start', schema: 'telemetryEvent', input: { kind: 'app_start', at: T0, tier: 'low', coldStartMs: 4200, catalog: '10k+' }, issues: [] },
  { name: 'telemetry.ingest', schema: 'telemetryEvent', input: { kind: 'ingest_done', at: T0, source: 'epg', ms: 61000, bytes: '1M+', items: '100k+' }, issues: [] },
  {
    name: 'telemetry.play-ok',
    schema: 'telemetryEvent',
    input: { kind: 'play_result', at: T0, engine: 'avplay', container: 'ts', mode: 'live', ttffMs: 1800, error: null },
    issues: [],
  },
  {
    name: 'telemetry.play-error',
    schema: 'telemetryEvent',
    input: { kind: 'play_result', at: T0, engine: 'html5', container: 'hls', mode: 'catchup', ttffMs: null, error: { kind: 'http', code: 'MEDIA_ERR_NETWORK', status: 403 } },
    issues: [],
  },
  { name: 'telemetry.stall', schema: 'telemetryEvent', input: event, issues: [] },
  { name: 'telemetry.epg-match', schema: 'telemetryEvent', input: { kind: 'epg_match', at: T0, rate: '75-99' }, issues: [] },
  {
    name: 'telemetry.capability',
    schema: 'telemetryEvent',
    input: { kind: 'capability', at: T0, model: 'UE43NU7400', firmware: 'T-KTM2AKUC-1490.4', chromium: 56, probes: { mse: true, 'hevc.main10': false, maxTextureSize: 4096 } },
    issues: [],
  },
  { name: 'telemetry.crash', schema: 'telemetryEvent', input: { kind: 'crash', at: T0, where: 'worker', stack: 'TypeError: x is undefined\n at a (main.js:1:2)' }, issues: [] },
  {
    name: 'telemetry.unknown-fields-dropped',
    schema: 'telemetryEvent',
    input: { ...event, url: 'http://secret.example/', name: 'A channel' },
    issues: [],
    output: event,
  },
  { name: 'telemetry.kind-unknown', schema: 'telemetryEvent', input: { kind: 'later', at: T0 }, issues: ['invalid_union@kind'] },
  { name: 'telemetry.rate-unknown', schema: 'telemetryEvent', input: { kind: 'epg_match', at: T0, rate: '80' }, issues: ['invalid_value@rate'] },
  { name: 'telemetry.tier-unknown', schema: 'telemetryEvent', input: { kind: 'app_start', at: T0, tier: 'mid', coldStartMs: 1, catalog: '0' }, issues: ['invalid_value@tier'] },
  {
    name: 'telemetry.container-unknown',
    schema: 'telemetryEvent',
    input: { kind: 'play_result', at: T0, engine: 'html5', container: 'dash', mode: 'vod', ttffMs: 900, error: null },
    issues: ['invalid_value@container'],
  },
  { name: 'telemetry.bucket-unknown', schema: 'telemetryEvent', input: { kind: 'ingest_done', at: T0, source: 'm3u', ms: 10, bytes: '2k', items: '0' }, issues: ['invalid_value@bytes'] },
  { name: 'telemetry.model-url', schema: 'telemetryEvent', input: { kind: 'capability', at: T0, model: 'http://x.example', firmware: '1', chromium: null, probes: {} }, issues: ['invalid_format@model'] },
  { name: 'telemetry.error-code-url', schema: 'telemetryEvent', input: { kind: 'play_result', at: T0, engine: 'mse', container: 'other', mode: 'vod', ttffMs: null, error: { kind: 'app', code: 'see http://x' } }, issues: ['invalid_format@error.code'] },
  {
    name: 'telemetry.error-code-host-port',
    schema: 'telemetryEvent',
    input: { kind: 'play_result', at: T0, engine: 'html5', container: 'ts', mode: 'live', ttffMs: null, error: { kind: 'network', code: 'cdn.example:8080' } },
    issues: ['invalid_format@error.code'],
  },
  { name: 'telemetry.stack-too-long', schema: 'telemetryEvent', input: { kind: 'crash', at: T0, where: 'main', stack: 'x'.repeat(4001) }, issues: ['too_big@stack'] },
  { name: 'telemetry.attempts-fraction', schema: 'telemetryEvent', input: { ...event, attempts: 1.5 }, issues: ['invalid_type@attempts'] },
];
