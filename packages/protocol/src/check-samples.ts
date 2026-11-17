/**
 * The protocol samples' checks (RELAY step 29b2a): one function that the Node tests and the old
 * engines (the vectors page in `dist/tv-vectors`, in a page and in a Blob worker) both run, so
 * zod's parsing gives the same verdicts on Chromium 53, 56 and 68 as in Node.
 *
 * `zod/mini` parses objects without generating code (its `z.object` is zod's interpreted
 * `$ZodObject`, never the `new Function` one classic zod uses), so the verdicts hold under a
 * content security policy without `unsafe-eval` too: test/crypto-vectors-bundle.test.ts runs
 * them in a realm that forbids code generation.
 *
 * Its own entry point (`@lablo/protocol/check-samples`): the app never imports it. Plain
 * ES2017 loops; it runs on Chromium 53.
 */
import type * as z from 'zod/mini';
import { backupEnvelopeSchema, lookupIdSchema } from './backup';
import { configDocSchema, configResponseSchema } from './config';
import {
  pairCreateRequestSchema,
  pairCreateResponseSchema,
  pairPayloadSchema,
  pairPollResponseSchema,
  pairStatusRequestSchema,
  pairTvKeyResponseSchema,
  pairUploadRequestSchema,
  pairUploadResponseSchema,
  sealedPayloadSchema,
} from './pairing';
import type { ProtocolSample, SampleSchema } from './samples';
import { SAMPLES } from './samples';
import { telemetryBatchSchema, telemetryEventSchema } from './telemetry';

export type { ProtocolSample, SampleSchema } from './samples';
export { SAMPLES } from './samples';

/** One sample's result, in the shape of `@lablo/crypto`'s `VectorResult`. */
export interface SampleResult {
  readonly name: string;
  readonly ok: boolean;
  /** Why it failed; empty when it passed. */
  readonly detail: string;
  readonly ms: number;
}

export const SAMPLE_SCHEMAS: Readonly<Record<SampleSchema, z.ZodMiniType>> = {
  configDoc: configDocSchema,
  configResponse: configResponseSchema,
  pairCreateRequest: pairCreateRequestSchema,
  pairCreateResponse: pairCreateResponseSchema,
  pairTvKeyResponse: pairTvKeyResponseSchema,
  sealedPayload: sealedPayloadSchema,
  pairUploadRequest: pairUploadRequestSchema,
  pairUploadResponse: pairUploadResponseSchema,
  pairPollResponse: pairPollResponseSchema,
  pairStatusRequest: pairStatusRequestSchema,
  pairPayload: pairPayloadSchema,
  backupEnvelope: backupEnvelopeSchema,
  lookupId: lookupIdSchema,
  telemetryBatch: telemetryBatchSchema,
  telemetryEvent: telemetryEventSchema,
};

/** The name the results carry: `protocol:` and the sample's own. */
export function sampleResultName(sample: Pick<ProtocolSample, 'name'>): string {
  return `protocol:${sample.name}`;
}

/** Same JSON value: objects compare by keys in any order. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    const key = aKeys[i]!;
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!sameJson((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
  }
  return true;
}

function issueText(issue: { readonly code: string; readonly path: ReadonlyArray<PropertyKey> }): string {
  let path = '';
  for (let i = 0; i < issue.path.length; i++) path += (i === 0 ? '' : '.') + String(issue.path[i]);
  return `${issue.code}@${path}`;
}

/** What parsing gave against what the sample says; empty when they agree. */
function mismatch(sample: ProtocolSample): string {
  const parsed = SAMPLE_SCHEMAS[sample.schema].safeParse(sample.input);
  const got: string[] = [];
  if (!parsed.success) for (let i = 0; i < parsed.error.issues.length; i++) got.push(issueText(parsed.error.issues[i]!));
  if (got.join(' ') !== sample.issues.join(' ')) return `issues [${got.join(', ')}], expected [${sample.issues.join(', ')}]`;
  if (parsed.success && !sameJson(parsed.data, sample.output === undefined ? sample.input : sample.output)) return 'a different output';
  return '';
}

/** Runs every sample. */
export function checkSamples(samples: readonly ProtocolSample[] = SAMPLES): SampleResult[] {
  const results: SampleResult[] = [];
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]!;
    const started = Date.now();
    let detail: string;
    try {
      detail = mismatch(sample);
    } catch (error) {
      detail = `threw ${String(error)}`;
    }
    results.push({ name: sampleResultName(sample), ok: detail === '', detail, ms: Date.now() - started });
  }
  return results;
}
