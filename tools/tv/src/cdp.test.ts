import { afterEach, describe, expect, it } from 'vitest';
import { evaluateOnPort, evaluateResult, pageTarget, parseDebugPort } from './cdp';
import type { TestServer } from './test-server';
import { startTestServer } from './test-server';
import { OPCODE } from './ws';

describe('parseDebugPort', () => {
  it("reads the port from sdb's debug answer", () => {
    expect(parseDebugPort('... successfully launched pid = 5287 with debug 1 port: 36597\n')).toBe(36_597);
    expect(parseDebugPort('port : 9222')).toBe(9222);
    expect(parseDebugPort('PORT: 37201')).toBe(37_201);
  });

  it('gives null without a usable port', () => {
    expect(parseDebugPort('closed')).toBeNull();
    expect(parseDebugPort('port: 0')).toBeNull();
    expect(parseDebugPort('port: 70000')).toBeNull();
    expect(parseDebugPort('port: 123456')).toBeNull();
    expect(parseDebugPort('export: 9222')).toBeNull();
    expect(parseDebugPort('port: 65535')).toBe(65_535);
    expect(parseDebugPort('port: 10')).toBe(10);
  });
});

describe('pageTarget', () => {
  it("prefers the first page's debugger URL", () => {
    expect(
      pageTarget(
        [
          { type: 'service_worker', id: 'w', webSocketDebuggerUrl: 'ws://127.0.0.1:1/w' },
          { type: 'page', id: 'p', webSocketDebuggerUrl: 'ws://127.0.0.1:1/p' },
          { type: 'page', id: 'q', webSocketDebuggerUrl: 'ws://127.0.0.1:1/q' },
        ],
        1,
      ),
    ).toBe('ws://127.0.0.1:1/p');
  });

  it('falls back to the first target, then to a URL built from its id', () => {
    expect(pageTarget([{ type: 'other', id: 'o', webSocketDebuggerUrl: 'ws://x/o' }], 9)).toBe('ws://x/o');
    expect(pageTarget([{ type: 'page', id: 'ABC' }], 9222)).toBe('ws://127.0.0.1:9222/devtools/page/ABC');
  });

  it('gives null when there is no usable target', () => {
    expect(pageTarget([], 1)).toBeNull();
    expect(pageTarget({ type: 'page' }, 1)).toBeNull();
    expect(pageTarget([null, 3], 1)).toBeNull();
    expect(pageTarget([{ type: 'page' }], 1)).toBeNull();
  });
});

describe('evaluateResult', () => {
  it('gives the value, undefined included', () => {
    expect(evaluateResult({ id: 1, result: { result: { type: 'string', value: 'live/channels/3' } } })).toEqual({ value: 'live/channels/3' });
    expect(evaluateResult({ id: 1, result: { result: { type: 'undefined' } } })).toEqual({ value: undefined });
    expect(evaluateResult({ id: 1 })).toEqual({ value: undefined });
  });

  it("gives the page's exception, or the protocol's error", () => {
    expect(
      evaluateResult({ id: 1, result: { result: {}, exceptionDetails: { text: 'Uncaught', exception: { description: 'ReferenceError: x is not defined' } } } }),
    ).toEqual({ error: 'the page threw: ReferenceError: x is not defined' });
    expect(evaluateResult({ id: 1, result: { exceptionDetails: { text: 'Uncaught' } } })).toEqual({ error: 'the page threw: Uncaught' });
    expect(evaluateResult({ id: 1, error: { code: -32601, message: 'no' } })).toEqual({ error: 'inspector error: {"code":-32601,"message":"no"}' });
  });
});

describe('evaluateOnPort (a local inspector, no TV)', () => {
  let server: TestServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  function inspector(answer: (expression: string) => unknown, list?: (port: number) => unknown): Promise<TestServer> {
    return startTestServer({
      http: (path, port) => (path === '/json' ? (list?.(port) ?? [{ type: 'page', id: 'P', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/P` }]) : undefined),
      onFrame: (frame, peer) => {
        if (frame.opcode !== OPCODE.text) return;
        const request = JSON.parse(frame.payload.toString()) as { id: number; method: string; params: { expression: string; awaitPromise: boolean; returnByValue: boolean } };
        expect(request.method).toBe('Runtime.evaluate');
        expect([request.params.awaitPromise, request.params.returnByValue]).toEqual([true, true]);
        // An event first, as the inspector may send one: it must not be taken for the answer.
        peer.send(OPCODE.text, JSON.stringify({ method: 'Runtime.consoleAPICalled', params: {} }));
        const reply = answer(request.params.expression);
        if (reply !== undefined) peer.send(OPCODE.text, JSON.stringify({ id: request.id, ...(reply as object) }));
      },
    });
  }

  it("returns the page's value", async () => {
    server = await inspector((expression) => ({ result: { result: { type: 'object', value: { got: expression } } } }));
    expect(await evaluateOnPort(server.port, '1 + 1')).toEqual({ got: '1 + 1' });
    expect(server.peers[0]?.path).toBe('/devtools/page/P');
  });

  it("rejects with the page's exception", async () => {
    server = await inspector(() => ({ result: { result: {}, exceptionDetails: { text: 'Uncaught', exception: { description: 'TypeError: boom' } } } }));
    await expect(evaluateOnPort(server.port, 'boom()')).rejects.toThrow('the page threw: TypeError: boom');
  });

  it('rejects when the inspector lists no page, or never answers', async () => {
    server = await inspector(() => undefined, () => []);
    await expect(evaluateOnPort(server.port, '1')).rejects.toThrow(`no page on the inspector at port ${server.port}`);
    await server.close();
    server = await inspector(() => undefined);
    await expect(evaluateOnPort(server.port, '1', 200)).rejects.toThrow('no answer from the inspector within 200 ms');
  });

  it('rejects when the debugger URL fails', async () => {
    server = await inspector(() => undefined, () => [{ type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/X' }]);
    await expect(evaluateOnPort(server.port, '1', 5000)).rejects.toThrow("the inspector's WebSocket failed (ws://127.0.0.1:1/devtools/page/X)");
  });
});
