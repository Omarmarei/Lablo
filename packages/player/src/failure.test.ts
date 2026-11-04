import { describe, expect, it } from 'vitest';
import type { PlaybackError } from './engine';
import { isPlaybackError } from './engine';
import type { AccountStatus } from './failure';
import { classifyFailure, isDefinitive, wantsAccountCheck } from './failure';

const ACTIVE: AccountStatus = { auth: true, status: 'Active', expDate: null, activeCons: 0, maxConnections: 1 };
const net: PlaybackError = { kind: 'network', code: 'MEDIA_ERR_NETWORK' };

function code(error: PlaybackError, online = true, account: AccountStatus | null = null): string {
  return classifyFailure({ error, online, account }).code;
}

describe('classifyFailure', () => {
  it('blames the internet first when the TV is offline', () => {
    expect(classifyFailure({ error: net, online: false })).toEqual({ category: 'internet', code: 'NET-OFFLINE', detail: 'MEDIA_ERR_NETWORK', account: null });
    expect(code({ kind: 'unsupported', code: 'X' }, false)).toBe('NET-OFFLINE');
  });

  it('blames the TV for formats it cannot play, unless the re-check finds an account problem', () => {
    const error: PlaybackError = { kind: 'unsupported', code: 'MEDIA_ERR_SRC_NOT_SUPPORTED' };
    expect(classifyFailure({ error, online: true })).toMatchObject({ category: 'device', code: 'TV-UNSUPPORTED', detail: 'MEDIA_ERR_SRC_NOT_SUPPORTED' });
    expect(code(error, true, ACTIVE)).toBe('TV-UNSUPPORTED');
    // A panel's "expired" page or clip looks like an unsupported format to a <video>.
    expect(classifyFailure({ error, online: true, account: { ...ACTIVE, status: 'Expired' } })).toMatchObject({ category: 'provider', code: 'PRV-EXPIRED' });
  });

  it('calls bugs app errors, whatever the account says', () => {
    expect(classifyFailure({ error: { kind: 'app', code: 'EXCEPTION' }, online: true, account: { ...ACTIVE, auth: false } })).toMatchObject({ category: 'app', code: 'APP-ERROR', detail: 'EXCEPTION' });
  });

  it('re-checks the account after provider and device failures only', () => {
    expect(wantsAccountCheck('provider')).toBe(true);
    expect(wantsAccountCheck('device')).toBe(true);
    expect(wantsAccountCheck('internet')).toBe(false);
    expect(wantsAccountCheck('app')).toBe(false);
  });

  it("names the account's own problem from the re-check, and keeps the answer", () => {
    const expired = { ...ACTIVE, status: 'Expired', expDate: 1_700_000_000 };
    expect(classifyFailure({ error: net, online: true, account: expired })).toEqual({ category: 'provider', code: 'PRV-EXPIRED', detail: 'MEDIA_ERR_NETWORK', account: expired });
    expect(code(net, true, { ...ACTIVE, auth: false })).toBe('PRV-AUTH');
    expect(code(net, true, { ...ACTIVE, status: 'Banned' })).toBe('PRV-BLOCKED');
    expect(code(net, true, { ...ACTIVE, status: 'Disabled' })).toBe('PRV-BLOCKED');
    expect(code(net, true, { ...ACTIVE, activeCons: 1, maxConnections: 1 })).toBe('PRV-MAX-CONNECTIONS');
    expect(code(net, true, { ...ACTIVE, activeCons: 3, maxConnections: 2 })).toBe('PRV-MAX-CONNECTIONS');
  });

  it('falls back to the stream error when the account looks fine', () => {
    expect(code(net, true, ACTIVE)).toBe('PRV-UNREACHABLE');
    expect(code(net, true, { ...ACTIVE, activeCons: 1, maxConnections: 2 })).toBe('PRV-UNREACHABLE');
    // No limit stated (0 or unknown), or no count.
    expect(code(net, true, { ...ACTIVE, activeCons: 5, maxConnections: 0 })).toBe('PRV-UNREACHABLE');
    expect(code(net, true, { ...ACTIVE, activeCons: 5, maxConnections: null })).toBe('PRV-UNREACHABLE');
    expect(code(net, true, { ...ACTIVE, activeCons: null, maxConnections: 1 })).toBe('PRV-UNREACHABLE');
  });

  it('puts the stream errors under the provider, with a code each', () => {
    expect(classifyFailure({ error: { kind: 'http', code: 'PROBE', status: 404 }, online: true })).toMatchObject({ category: 'provider', code: 'PRV-HTTP-404' });
    expect(code({ kind: 'http', code: 'PROBE' })).toBe('PRV-HTTP');
    expect(code({ kind: 'http', code: 'PROBE', status: 509 })).toBe('PRV-HTTP-509');
    expect(code(net)).toBe('PRV-UNREACHABLE');
    expect(code({ kind: 'timeout', code: 'OPEN' })).toBe('PRV-TIMEOUT');
    expect(code({ kind: 'stall', code: 'FROZEN' })).toBe('PRV-STALLED');
    expect(code({ kind: 'decode', code: 'MEDIA_ERR_DECODE' })).toBe('PRV-BAD-STREAM');
  });
});

describe('isDefinitive', () => {
  it('is true where retrying the same URL cannot help', () => {
    expect(isDefinitive({ kind: 'unsupported', code: 'X' })).toBe(true);
    for (const status of [400, 401, 403, 404, 410, 499]) expect(isDefinitive({ kind: 'http', code: 'X', status })).toBe(true);
  });

  it('is false for everything a retry may fix', () => {
    for (const status of [399, 408, 429, 500, 503, 509]) expect(isDefinitive({ kind: 'http', code: 'X', status })).toBe(false);
    expect(isDefinitive({ kind: 'http', code: 'X' })).toBe(false);
    for (const kind of ['network', 'timeout', 'stall', 'decode', 'app'] as const) expect(isDefinitive({ kind, code: 'X', status: 404 })).toBe(false);
  });
});

describe('isPlaybackError', () => {
  it('accepts only a known kind with a code', () => {
    expect(isPlaybackError({ kind: 'network', code: 'X' })).toBe(true);
    expect(isPlaybackError({ kind: 'http', code: 'X', status: 500 })).toBe(true);
    expect(isPlaybackError({ kind: 'nope', code: 'X' })).toBe(false);
    expect(isPlaybackError({ kind: 'network' })).toBe(false);
    expect(isPlaybackError(new Error('boom'))).toBe(false);
    expect(isPlaybackError(null)).toBe(false);
    expect(isPlaybackError('network')).toBe(false);
  });
});
