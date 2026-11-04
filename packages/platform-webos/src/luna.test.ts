import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServiceBridge } from './luna';
import { DEVICE_ID_URI, LunaError, lgudidFrom, lunaRequest, readLgudid, webosSelectTrack } from './luna';

/** A bridge that answers `reply` (or nothing) after `delayMs`, and records its calls. */
function fakeBridge(reply: string | null, delayMs = 0) {
  const calls: Array<{ uri: string; params: string }> = [];
  let cancelled = 0;
  const bridge: ServiceBridge = {
    onservicecallback: null,
    call(uri, params) {
      calls.push({ uri, params });
      if (reply === null) return;
      setTimeout(() => bridge.onservicecallback?.(reply), delayMs);
    },
    cancel() {
      cancelled += 1;
    },
  };
  return { bridge, calls, cancelled: () => cancelled };
}

const LGUDID = '095f142a-8f3e-4a2c-9b10-6c1d2e3f4a5b';
const ANSWER = JSON.stringify({ returnValue: true, idList: [{ idType: 'LGUDID', idValue: LGUDID }] });

afterEach(() => {
  vi.useRealTimers();
});

describe('lunaRequest over PalmServiceBridge', () => {
  it('calls the URI with JSON parameters and resolves the answer', async () => {
    const fake = fakeBridge(ANSWER);
    const answer = await lunaRequest(DEVICE_ID_URI, '{"idType":["LGUDID"]}', { bridge: () => fake.bridge });
    expect(fake.calls).toEqual([{ uri: 'luna://com.webos.service.sm/deviceid/getIDs', params: '{"idType":["LGUDID"]}' }]);
    expect(answer.returnValue).toBe(true);
    // Finished: the callback is dropped and the call cancelled.
    expect(fake.bridge.onservicecallback).toBeNull();
    expect(fake.cancelled()).toBe(1);
  });

  it('rejects returnValue false with the error text and code', async () => {
    const fake = fakeBridge(JSON.stringify({ returnValue: false, errorCode: -1, errorText: 'Unknown method' }));
    await expect(lunaRequest('luna://x/y', '{}', { bridge: () => fake.bridge })).rejects.toThrow('luna://x/y failed: Unknown method (-1)');
  });

  it.each([
    ['not JSON', '{oops', 'something other than JSON'],
    ['an array', '[1]', 'something other than an object'],
    ['null', 'null', 'something other than an object'],
  ])('rejects an answer that is %s', async (_what, reply, message) => {
    const fake = fakeBridge(reply);
    await expect(lunaRequest('luna://x/y', '{}', { bridge: () => fake.bridge })).rejects.toThrow(message);
  });

  it('rejects without a bridge (a desktop browser)', async () => {
    const error = await lunaRequest('luna://x/y', '{}', { bridge: () => null }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LunaError);
    expect((error as Error).message).toBe('no PalmServiceBridge for luna://x/y');
  });

  it('rejects when the call throws', async () => {
    const bridge: ServiceBridge = {
      onservicecallback: null,
      call() {
        throw new Error('denied');
      },
    };
    await expect(lunaRequest('luna://x/y', '{}', { bridge: () => bridge })).rejects.toThrow('luna://x/y threw: denied');
  });

  it('times out, and ignores an answer after that', async () => {
    vi.useFakeTimers();
    const fake = fakeBridge(ANSWER, 5000);
    const result = lunaRequest('luna://x/y', '{}', { bridge: () => fake.bridge, timeoutMs: 3000 });
    const caught = result.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(3000);
    expect(((await caught) as Error).message).toBe('luna://x/y did not answer within 3000 ms');
    await vi.advanceTimersByTimeAsync(5000);
    expect(fake.cancelled()).toBe(1);
  });
});

describe('the LGUDID (deviceSecret on webOS)', () => {
  it('reads the LGUDID entry of idList', async () => {
    expect(await readLgudid(() => fakeBridge(ANSWER).bridge)).toBe(LGUDID);
    expect(lgudidFrom({ idList: [{ idType: 'NDUID', idValue: 'x' }, { idType: 'LGUDID', idValue: ` ${LGUDID} ` }] })).toBe(LGUDID);
  });

  it.each([
    ['no idList', {}],
    ['idList not an array', { idList: 'x' }],
    ['only other ids', { idList: [{ idType: 'NDUID', idValue: 'x' }] }],
    ['an empty value', { idList: [{ idType: 'LGUDID', idValue: '  ' }] }],
    ['a value that is not text', { idList: [{ idType: 'LGUDID', idValue: 42 }, null] }],
  ])('is null for %s', (_what, answer) => {
    expect(lgudidFrom(answer)).toBeNull();
  });

  it('is null when the service fails or is missing', async () => {
    expect(await readLgudid(() => fakeBridge(JSON.stringify({ returnValue: false, errorText: 'Denied' })).bridge)).toBeNull();
    expect(await readLgudid(() => null)).toBeNull();
  });
});

describe("selectTrack by the element's mediaId (RELAY step 15c2, S5)", () => {
  it('asks com.webos.media for the type and index, quoting the mediaId', async () => {
    const fake = fakeBridge('{"returnValue":true}');
    expect(await webosSelectTrack('_Mo4aBx"9', 'audio', 2, () => fake.bridge)).toEqual({ returnValue: true });
    expect(fake.calls).toEqual([{ uri: 'luna://com.webos.media/selectTrack', params: '{"mediaId":"_Mo4aBx\\"9","type":"audio","index":2}' }]);
    expect(JSON.parse(fake.calls[0]?.params ?? '')).toEqual({ mediaId: '_Mo4aBx"9', type: 'audio', index: 2 });
    await webosSelectTrack('m', 'text', 0, () => fake.bridge);
    expect(fake.calls[1]?.params).toBe('{"mediaId":"m","type":"text","index":0}');
  });

  it("passes the service's refusal on, and refuses an index that is no track's", async () => {
    const fake = fakeBridge('{"returnValue":false,"errorCode":-1,"errorText":"invalid mediaId"}');
    await expect(webosSelectTrack('m', 'audio', 1, () => fake.bridge)).rejects.toThrow('luna://com.webos.media/selectTrack failed: invalid mediaId (-1)');
    for (const index of [-1, 1.5, Number.NaN]) await expect(webosSelectTrack('m', 'audio', index, () => fake.bridge)).rejects.toThrow(`selectTrack: no track ${String(index)}`);
    expect(fake.calls).toHaveLength(1);
  });
});
