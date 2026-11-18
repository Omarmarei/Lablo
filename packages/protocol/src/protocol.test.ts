import { describe, expect, it } from 'vitest';
import type { ProtocolSample } from './check-samples';
import { checkSamples, SAMPLE_SCHEMAS, SAMPLES, sameJson, sampleResultName } from './check-samples';
import {
  BACKUP_BODY_MAX_BYTES,
  BACKUP_CT_MAX_CHARS,
  BACKUP_WRITE_HEADER,
  base64UrlLength,
  bytes16,
  bytes32,
  configDocSchema,
  COUNT_BUCKETS,
  countBucket,
  nonce24,
  PAIR_BODY_MAX_BYTES,
  PAIR_CT_MAX_CHARS,
  PAIR_FILE_MAX_BYTES,
  PAIR_PAYLOAD_MAX_BYTES,
  rateBucket,
  readTelemetryEvents,
  signature64,
  TELEMETRY_BATCH_MAX,
  TELEMETRY_BODY_MAX_BYTES,
  TELEMETRY_KINDS,
  telemetryEventSchema,
} from './index';

describe('the shared samples', () => {
  it('all pass in Node', () => {
    const results = checkSamples();
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results.map((r) => r.name)).toEqual(SAMPLES.map((s) => `protocol:${s.name}`));
  });

  it('have unique names and cover every schema with a valid and an invalid input', () => {
    expect(new Set(SAMPLES.map((s) => s.name)).size).toBe(SAMPLES.length);
    for (const schema of Object.keys(SAMPLE_SCHEMAS)) {
      const mine = SAMPLES.filter((s) => s.schema === schema);
      expect([schema, mine.some((s) => s.issues.length === 0)]).toEqual([schema, true]);
      expect([schema, mine.some((s) => s.issues.length > 0)]).toEqual([schema, true]);
    }
  });

  it('cover every telemetry kind with a valid event', () => {
    const kinds = SAMPLES.filter((s) => s.schema === 'telemetryEvent' && s.issues.length === 0).map((s) => (s.input as { kind: string }).kind);
    for (const kind of TELEMETRY_KINDS) expect(kinds).toContain(kind);
  });

  const sample = (changes: Partial<ProtocolSample>): ProtocolSample => ({ ...SAMPLES.find((s) => s.name === 'config.minimal')!, ...changes });

  it('fail when an expected issue is not given', () => {
    const [result] = checkSamples([sample({ issues: ['invalid_value@v'] })]);
    expect(result).toMatchObject({ name: 'protocol:config.minimal', ok: false, detail: 'issues [], expected [invalid_value@v]' });
  });

  it('fail when an issue comes on another path or with another code', () => {
    const input = { ...(SAMPLES[0]!.input as object), v: 2 };
    expect(checkSamples([sample({ input, issues: ['invalid_value@issuedAt'] })])[0]!.ok).toBe(false);
    expect(checkSamples([sample({ input, issues: ['invalid_type@v'] })])[0]!.ok).toBe(false);
    expect(checkSamples([sample({ input, issues: ['invalid_value@v'] })])[0]!.ok).toBe(true);
  });

  it('fail when the output differs, and when an expected output is not given', () => {
    const input = { ...(SAMPLES[0]!.input as object), extra: 1 };
    expect(checkSamples([sample({ input })])[0]).toMatchObject({ ok: false, detail: 'a different output' });
    expect(checkSamples([sample({ input, output: SAMPLES[0]!.input })])[0]!.ok).toBe(true);
    expect(checkSamples([sample({ output: { v: 1 } })])[0]!.ok).toBe(false);
  });

  it('report a throw as a failure, not an exception', () => {
    const throwing = { get v(): number { throw new Error('boom'); } };
    expect(checkSamples([sample({ input: throwing })])[0]).toMatchObject({ ok: false, detail: 'threw Error: boom' });
  });

  it('name each result after its sample', () => {
    expect(sampleResultName({ name: 'x.y' })).toBe('protocol:x.y');
  });
});

describe('sameJson', () => {
  it('compares values, objects in any key order, arrays in order', () => {
    expect(sameJson({ a: 1, b: [1, { c: 'x' }] }, { b: [1, { c: 'x' }], a: 1 })).toBe(true);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
    expect(sameJson({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameJson({ a: undefined }, { b: undefined })).toBe(false);
    expect(sameJson([], {})).toBe(false);
    expect(sameJson(null, {})).toBe(false);
    expect(sameJson(1, '1')).toBe(false);
  });
});

describe('the base64url byte strings', () => {
  it('take exactly their length', () => {
    for (const [schema, bytes] of [
      [bytes16, 16],
      [nonce24, 24],
      [bytes32, 32],
      [signature64, 64],
    ] as const) {
      const chars = base64UrlLength(bytes);
      // `A` is all zero bits: a valid last character at any length.
      expect(schema.safeParse('A'.repeat(chars)).success).toBe(true);
      expect(schema.safeParse('A'.repeat(chars + 1)).success).toBe(false);
      expect(schema.safeParse('A'.repeat(chars - 1)).success).toBe(false);
      expect(schema.safeParse(`${'A'.repeat(chars - 1)}=`).success).toBe(false);
    }
  });

  it('refuse a last character with unused bits set', () => {
    expect(bytes16.safeParse(`${'A'.repeat(21)}B`).success).toBe(false);
    expect(bytes32.safeParse(`${'A'.repeat(42)}B`).success).toBe(false);
    expect(signature64.safeParse(`${'A'.repeat(85)}B`).success).toBe(false);
    expect(bytes32.safeParse(`${'A'.repeat(42)}E`).success).toBe(true);
    expect(bytes16.safeParse(`${'A'.repeat(21)}Q`).success).toBe(true);
  });
});

describe('the limits', () => {
  it('are the ones architecture.md §3.2 gives', () => {
    expect(PAIR_PAYLOAD_MAX_BYTES).toBe(32 * 1024);
    expect(PAIR_BODY_MAX_BYTES).toBe(64 * 1024);
    expect(PAIR_FILE_MAX_BYTES).toBe(40 * 1024 * 1024);
    expect(BACKUP_BODY_MAX_BYTES).toBe(512 * 1024);
    expect(BACKUP_WRITE_HEADER).toBe('x-write-token');
    expect(TELEMETRY_BODY_MAX_BYTES).toBe(64 * 1024);
    expect(TELEMETRY_BATCH_MAX).toBe(200);
  });

  it('fit a ciphertext of the largest payload or envelope into its body', () => {
    // A pairing body is `{"phonePk":"…","nonce":"…","ct":"…"}`.
    expect(PAIR_CT_MAX_CHARS + 43 + 32 + 40).toBeLessThanOrEqual(PAIR_BODY_MAX_BYTES);
    expect(BACKUP_CT_MAX_CHARS + 32 + 60).toBeLessThanOrEqual(BACKUP_BODY_MAX_BYTES);
    expect(BACKUP_CT_MAX_CHARS).toBeGreaterThan(BACKUP_BODY_MAX_BYTES - 2048);
  });
});

describe('the config doc', () => {
  it('runs its expiry check only on an otherwise valid doc', () => {
    const doc = SAMPLES.find((s) => s.name === 'config.minimal')!.input as Record<string, unknown>;
    const parsed = configDocSchema.safeParse({ ...doc, expiresAt: doc.issuedAt, v: 2 });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((i) => i.code)).toEqual(['invalid_value']);
  });
});

describe('the telemetry buckets', () => {
  it('put a count in its order of magnitude', () => {
    const cases: Array<[number, string]> = [
      [-5, '0'],
      [Number.NaN, '0'],
      [0, '0'],
      [0.5, '0'],
      [1, '1+'],
      [9, '1+'],
      [10, '10+'],
      [99, '10+'],
      [100, '100+'],
      [999, '100+'],
      [1000, '1k+'],
      [9999, '1k+'],
      [10000, '10k+'],
      [99999, '10k+'],
      [100000, '100k+'],
      [999999, '100k+'],
      [1000000, '1M+'],
      [5e9, '1M+'],
      [Number.POSITIVE_INFINITY, '1M+'],
    ];
    for (const [count, bucket] of cases) expect([count, countBucket(count)]).toEqual([count, bucket]);
    expect(COUNT_BUCKETS).toHaveLength(8);
  });

  it('put a share in its quarter, with none and all on their own', () => {
    const cases: Array<[number, number, string]> = [
      [0, 0, '0'],
      [5, 0, '0'],
      [0, 10, '0'],
      [-1, 10, '0'],
      [1, 1000, '1-24'],
      [24, 100, '1-24'],
      [25, 100, '25-49'],
      [49, 100, '25-49'],
      [50, 100, '50-74'],
      [74, 100, '50-74'],
      [75, 100, '75-99'],
      [999, 1000, '75-99'],
      [1000, 1000, '100'],
      [1001, 1000, '100'],
      [1, Number.NaN, '0'],
    ];
    for (const [part, whole, bucket] of cases) expect([part, whole, rateBucket(part, whole)]).toEqual([part, whole, bucket]);
  });
});

describe('readTelemetryEvents', () => {
  const stall = { kind: 'stall', at: 1, recovered: false, attempts: 3 };

  it('keeps the events it can read, stripped, and counts the rest', () => {
    const read = readTelemetryEvents([stall, { kind: 'later', at: 1 }, { ...stall, name: 'A channel' }, null, 'x']);
    expect(read.events).toEqual([stall, stall]);
    expect(read.dropped).toBe(3);
    expect(readTelemetryEvents([])).toEqual({ events: [], dropped: 0 });
  });

  it('gives events of the schema type', () => {
    const parsed = telemetryEventSchema.parse(stall);
    expect(parsed.kind === 'stall' && parsed.attempts).toBe(3);
  });
});
