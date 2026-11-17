import type { ConfigResult } from '@lablo/data';
import { noPolicy } from '@lablo/data/client';
import { describe, expect, it } from 'vitest';
import { describeBlocked, describeConfig } from './hello-config';

const ISSUED = Date.UTC(2026, 10, 17, 9, 30, 0);

function result(fields: Partial<ConfigResult> = {}, policy: Partial<ConfigResult['policy']> = {}): ConfigResult {
  return { status: 'fresh', policy: { ...noPolicy(), ...policy }, issuedAt: ISSUED, expiresAt: ISSUED + 1, failure: null, stored: true, ...fields };
}

describe("the hello screen's config row (step 30c1)", () => {
  it('shows a fresh doc: when it was issued, nothing killed, no notices', () => {
    expect(describeConfig(result())).toEqual({
      text: 'ok: fresh, issued 2026-11-17T09:30:00.000Z, nothing killed, no notices',
      status: 'fresh',
      failure: '',
      kill: '',
      notices: '',
    });
  });

  it('shows the kill rule, the notices in order, an update asked for and a copy not stored', () => {
    const row = describeConfig(
      result(
        { stored: false },
        {
          kill: { id: 'off', mode: 'disable-app', message: null },
          notices: [
            { id: 'n1', mode: 'notice', message: null },
            { id: 'n2', mode: 'notice', message: null },
          ],
          updateRequired: true,
        },
      ),
    );
    expect(row.text).toBe('ok: fresh, issued 2026-11-17T09:30:00.000Z, kill off (disable-app), notices n1 n2, update required, not stored');
    expect(row.kill).toBe('off:disable-app');
    expect(row.notices).toBe('n1,n2');
    expect(describeConfig(result({}, { notices: [{ id: 'only', mode: 'notice', message: null }] })).notices).toBe('only');
  });

  it('shows a cached copy kept, and why the fetch gave none', () => {
    const row = describeConfig(result({ status: 'cached', failure: 'bad-signature' }));
    expect(row.text).toBe('ok: cached (bad-signature), issued 2026-11-17T09:30:00.000Z, nothing killed, no notices');
    expect(row.status).toBe('cached');
    expect(row.failure).toBe('bad-signature');
    // The cached copy read before a fetch (the worker's first answer) has no failure.
    expect(describeConfig(result({ status: 'cached' })).text).toMatch(/^ok: cached \(not fetched\), /);
  });

  it('shows the defaults when there is no doc', () => {
    const row = describeConfig(result({ status: 'none', issuedAt: null, expiresAt: null, failure: 'network', stored: false }));
    expect(row).toEqual({ text: 'none: network (nothing killed, nothing blocked)', status: 'none', failure: 'network', kill: '', notices: '' });
    expect(describeConfig(result({ status: 'none', issuedAt: null, expiresAt: null, stored: false })).text).toBe(
      'none: no config (nothing killed, nothing blocked)',
    );
  });
});

describe("the hello screen's blocklist row (step 30c1)", () => {
  it('names each answer in order, and lists them for the harness', () => {
    expect(describeBlocked([true, true, false])).toEqual({ text: 'ok: blocked, blocked, allowed', blocked: 'true,true,false' });
    expect(describeBlocked([false])).toEqual({ text: 'ok: allowed', blocked: 'false' });
    expect(describeBlocked([])).toEqual({ text: 'ok: ', blocked: '' });
  });
});
