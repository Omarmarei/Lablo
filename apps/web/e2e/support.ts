import { createRequire } from 'node:module';
import path from 'node:path';
import type { APIRequestContext, Page } from '@playwright/test';
import { test as base, expect } from '@playwright/test';
import type * as Pg from 'pg';
import { newBoxKeyPair, openPairPayload, sha256, toBase64Url, utf8 } from '@lablo/crypto';
import type { PairPayload, PairPurpose, PairStatus } from '@lablo/protocol';
import { pairCreateResponseSchema, pairFileUrlResponseSchema, pairPayloadSchema, pairPollResponseSchema } from '@lablo/protocol';
import { E2E_DATABASE, serverUrl, WEB, withDatabase } from '../test/web-db';

/**
 * What the phone page's specs share (RELAY step 31b): a scripted TV over the API, an address per
 * test (the routes' rate limits key on `x-forwarded-for`, which Next's own server keeps when a
 * client sends it), every request the page makes checked against its origin, and the database.
 */

const pg = createRequire(path.join(WEB, 'package.json'))('pg') as typeof Pg;

/** A TV: its key pair stays here; it registers, polls and reports over HTTP. */
export class Tv {
  readonly keys = newBoxKeyPair();
  sid = '';
  code = '';
  pollToken = '';

  constructor(
    private readonly request: APIRequestContext,
    private readonly address: string,
    /** Why the TV shows its code (RELAY step 38c4): a check's QR link and session say so. */
    readonly purpose: PairPurpose = 'add',
  ) {}

  get tvPk(): string {
    return toBase64Url(this.keys.publicKey);
  }

  /** The QR link's path and fragment (a check's ends `&p=check`, as the TV's does). */
  get qrPath(): string {
    return `/p#c=${this.code}&k=${this.tvPk}${this.purpose === 'check' ? '&p=check' : ''}`;
  }

  private headers(token = false): Record<string, string> {
    return { 'x-forwarded-for': this.address, origin: 'null', ...(token ? { authorization: `Bearer ${this.pollToken}` } : {}) };
  }

  async register(): Promise<this> {
    const data = this.purpose === 'check' ? { tvPk: this.tvPk, purpose: 'check' } : { tvPk: this.tvPk };
    const answer = await this.request.post('/v1/pair', { data, headers: this.headers() });
    expect(answer.status()).toBe(201);
    const made = pairCreateResponseSchema.parse(await answer.json());
    Object.assign(this, { sid: made.sid, code: made.code, pollToken: made.pollToken });
    return this;
  }

  /** One poll: `waiting`, or the payload opened with this TV's secret key and parsed. */
  async poll(): Promise<{ state: 'waiting' } | { state: 'ready'; payload: PairPayload }> {
    const answer = await this.request.get(`/v1/pair/s/${this.sid}`, { headers: this.headers(true) });
    expect(answer.status()).toBe(200);
    const polled = pairPollResponseSchema.parse(await answer.json());
    if (polled.state === 'waiting') return { state: 'waiting' };
    const plain = openPairPayload(polled.payload, this.keys.secretKey);
    expect(plain, 'the payload opens with the TV’s secret key').not.toBeNull();
    return { state: 'ready', payload: pairPayloadSchema.parse(JSON.parse(new TextDecoder().decode(plain!))) };
  }

  /** Polls until the phone's payload is there, then gives it opened. */
  async receive(): Promise<PairPayload> {
    let payload: PairPayload | null = null;
    await expect(async () => {
      const got = await this.poll();
      if (got.state === 'ready') payload = got.payload;
      expect(got.state).toBe('ready');
    }).toPass({ timeout: 10_000, intervals: [250] });
    return payload!;
  }

  async report(status: PairStatus): Promise<void> {
    const answer = await this.request.post(`/v1/pair/s/${this.sid}/status`, { data: { status }, headers: this.headers(true) });
    expect(answer.status()).toBe(200);
  }

  /** The presigned GET of the session's file (RELAY step 31d1), as the API gives it to the TV. */
  async fileUrl(): Promise<string> {
    const answer = await this.request.get(`/v1/pair/s/${this.sid}/file`, { headers: this.headers(true) });
    expect(answer.status()).toBe(200);
    return pairFileUrlResponseSchema.parse(await answer.json()).url;
  }

  /** A GET of a presigned URL from the TV's origin (a relative one against the API's address): the status, its CORS header, the bytes. */
  async download(url: string): Promise<{ status: number; cors: string | undefined; bytes: Uint8Array }> {
    const answer = await this.request.get(url, { headers: { origin: 'null' } });
    return { status: answer.status(), cors: answer.headers()['access-control-allow-origin'], bytes: new Uint8Array(await answer.body()) };
  }
}

/** Runs `sql` against the e2e database. */
export async function sql(text: string, values: unknown[] = []): Promise<number> {
  const client = new pg.Client({ connectionString: withDatabase(serverUrl(), E2E_DATABASE) });
  await client.connect();
  try {
    return (await client.query(text, values)).rowCount ?? 0;
  } finally {
    await client.end();
  }
}

/** Ends a code now, as ten minutes would (its row's `expiresAt` in the past). */
export async function endCode(code: string): Promise<void> {
  const rows = await sql(`UPDATE "PairSession" SET "expiresAt" = now() - interval '1 second' WHERE "codeHash" = $1`, [toBase64Url(sha256(utf8(code)))]);
  expect(rows).toBe(1);
}

let addresses = 0;

interface Fixtures {
  /** This test's caller address (`x-forwarded-for`) for the page. */
  address: string;
  /** A new registered TV, calling from its own address; `check` for the PIN's login check (step 38c4). */
  tv: (purpose?: PairPurpose) => Promise<Tv>;
  /** Every URL the page asked for. */
  requests: string[];
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  address: async ({}, use, testInfo) => {
    addresses += 1;
    await use(`10.${testInfo.workerIndex % 250}.${Math.floor(addresses / 250)}.${addresses % 250}`);
  },
  tv: async ({ request }, use, testInfo) => {
    let made = 0;
    await use(async (purpose?: PairPurpose) => {
      made += 1;
      return new Tv(request, `10.250.${testInfo.workerIndex % 250}.${made}`, purpose).register();
    });
  },
  requests: [
    async ({ page, address, baseURL }, use) => {
      await page.context().setExtraHTTPHeaders({ 'x-forwarded-for': address });
      const urls: string[] = [];
      page.on('request', (request) => urls.push(request.url()));
      await use(urls);
      // The page never asks another host for anything (RELAY step 31b's "only its own origin").
      // (The typed-code test sees its key request here, so the listener works.)
      const origin = new URL(baseURL!).origin;
      expect(urls.filter((url) => new URL(url).origin !== origin)).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Opens the TV's QR link as a phone's camera would: a new load of the page (a `goto` from `/p` to
 * `/p#…` would only change the fragment).
 */
export async function openQr(page: Page, tv: Tv): Promise<void> {
  await page.goto('about:blank');
  await page.goto(tv.qrPath);
}

/** The page's own messages (Next adds a `role="alert"` route announcer of its own). */
export function alert(page: Page) {
  return page.getByTestId('phone').getByRole('alert');
}

/** The phone page's root, whose `data-view` names the view. */
export function phone(page: Page) {
  return page.getByTestId('phone');
}

/** Saves a screenshot to artifacts/screenshots for a person to look at. */
export async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join('artifacts', 'screenshots', `${name}.png`), fullPage: true });
}

/** Text without the isolates `catalog.ts` puts around a placeholder's value. */
export function plain(text: string): string {
  return text.replace(/[\u2066-\u2069]/g, '');
}
