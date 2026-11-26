import { afterEach, describe, expect, it } from 'vitest';
import type { InspectorSocket } from './cdp';
import { evaluateOnPort, evaluateResult, pageTarget, parseDebugPort } from './cdp';
import type { TestServer } from './test-server';
import { startTestServer } from './test-server';
import { webosPage } from './webos';
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

  it("with a page (webOS, step 56), takes only a page whose URL holds it: the app's, not the lab's or the TV's own", () => {
    const at = (name: string): string => `file:///media/developer/apps/usr/palm/applications/${name}/index.html`;
    const list = [
      { type: 'page', id: 'H', url: 'file:///usr/palm/applications/com.webos.app.home/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:9998/devtools/page/H' },
      { type: 'page', id: 'L', url: at('com.lablo.iptv.lab'), webSocketDebuggerUrl: 'ws://127.0.0.1:9998/devtools/page/L' },
      { type: 'other', id: 'W', url: at('com.lablo.iptv'), webSocketDebuggerUrl: 'ws://127.0.0.1:9998/devtools/page/W' },
      { type: 'page', id: 'A', url: at('com.lablo.iptv') },
    ];
    expect(pageTarget(list, 9998, webosPage('com.lablo.iptv'))).toBe('ws://127.0.0.1:9998/devtools/page/A');
    expect(pageTarget(list, 9998, webosPage('com.lablo.iptv.lab'))).toBe('ws://127.0.0.1:9998/devtools/page/L');
    expect(pageTarget(list, 9998)).toBe('ws://127.0.0.1:9998/devtools/page/H');
    expect(pageTarget(list, 9998, '/com.example/')).toBeNull();
    expect(pageTarget([{ type: 'page', id: 'X' }, { type: 'page', id: 'Y', url: 7 }], 9998, '/com.lablo.iptv/')).toBeNull();
    expect(pageTarget({ url: at('com.lablo.iptv') }, 9998, '/com.lablo.iptv/')).toBeNull();
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
    await expect(evaluateOnPort(server.port, '1', { timeoutMs: 200 })).rejects.toThrow(/no answer from the inspector within 200 ms. .*allows one client at a time/);
  });

  it("on webOS, evaluates in the app's page among the runtime's pages, or names the pages it found (step 56)", async () => {
    const page = (port: number, id: string, url?: string): unknown => ({ type: 'page', id, ...(url === undefined ? {} : { url }), webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${id}` });
    const home = 'file:///usr/palm/applications/com.webos.app.home/index.html';
    const app = 'file:///media/developer/apps/usr/palm/applications/com.lablo.iptv/index.html';
    server = await inspector(
      (expression) => ({ result: { result: { value: expression } } }),
      (port) => [page(port, 'H', home), page(port, 'A', app)],
    );
    expect(await evaluateOnPort(server.port, 'location.href', { page: webosPage('com.lablo.iptv') })).toBe('location.href');
    expect(server.peers.map((peer) => peer.path)).toEqual(['/devtools/page/A']);
    await expect(evaluateOnPort(server.port, '1', { page: webosPage('com.lablo.iptv.lab') })).rejects.toThrow(
      `no page of /com.lablo.iptv.lab/ on the inspector at port ${server.port} (is the app running?); it lists: ${home}, ${app}`,
    );
    await server.close();
    server = await inspector(() => undefined, (port) => [page(port, 'Q')]);
    await expect(evaluateOnPort(server.port, '1', { page: '/x/' })).rejects.toThrow('(is the app running?); it lists: Q');
    await server.close();
    server = await inspector(() => undefined, () => []);
    await expect(evaluateOnPort(server.port, '1', { page: '/x/' })).rejects.toThrow('(is the app running?); it lists: nothing');
  });

  /** A socket that never opens and, like Node 22's, fires `error` again from inside `close()`. */
  class NeverOpens implements InspectorSocket {
    closes = 0;
    private readonly onError: (() => void)[] = [];
    constructor(failAtOnce: boolean) {
      if (failAtOnce) setTimeout(() => this.fail(), 5);
    }
    addEventListener(type: 'open' | 'error' | 'message', listener: (() => void) | ((event: { readonly data: unknown }) => void)): void {
      if (type === 'error') this.onError.push(listener as () => void);
    }
    send(): void {
      throw new Error('never opened');
    }
    close(): void {
      this.closes += 1;
      if (this.closes > 20) throw new RangeError('close() called itself');
      this.fail();
    }
    private fail(): void {
      for (const listener of this.onError) listener();
    }
  }

  it("rejects a failed socket once, without closing it (Node 22's close() fires error again)", async () => {
    server = await inspector(() => undefined);
    // Made when the client opens it, after its fetch of /json: a socket made before that failed
    // before anyone listened whenever the fetch took over 5 ms (CI, step 40ci).
    const sockets: NeverOpens[] = [];
    const open = (): InspectorSocket => {
      const socket = new NeverOpens(true);
      sockets.push(socket);
      return socket;
    };
    await expect(evaluateOnPort(server.port, '1', { timeoutMs: 100, open })).rejects.toThrow(/the inspector's WebSocket failed \(ws:\/\/127\.0\.0\.1:.*allows one client at a time/);
    // Past the time limit too: its timer is gone, or it would close the socket (and hold the CLI open).
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(sockets.map((socket) => socket.closes)).toEqual([0]);
  });

  it('closes once after the answer, its timer gone', async () => {
    server = await inspector(() => undefined);
    const listeners: Record<string, ((event: { readonly data: unknown }) => void)[]> = {};
    let closes = 0;
    const socket: InspectorSocket = {
      addEventListener: (type: string, listener: (event: { readonly data: unknown }) => void) => {
        (listeners[type] ??= []).push(listener);
      },
      send: (data) => {
        const { id } = JSON.parse(data) as { id: number };
        for (const listener of listeners.message ?? []) listener({ data: JSON.stringify({ id, result: { result: { value: 42 } } }) });
      },
      close: () => {
        closes += 1;
      },
    };
    // It opens 5 ms after the client asks for it (after the client's fetch of /json, as above).
    const open = (): InspectorSocket => {
      setTimeout(() => {
        for (const listener of listeners.open ?? []) listener({ data: null });
      }, 5);
      return socket;
    };
    expect(await evaluateOnPort(server.port, '6 * 7', { timeoutMs: 100, open })).toBe(42);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(closes).toBe(1);
  });

  it('rejects with the time limit, not the error its close() fires', async () => {
    server = await inspector(() => undefined);
    const socket = new NeverOpens(false);
    await expect(evaluateOnPort(server.port, '1', { timeoutMs: 50, open: () => socket })).rejects.toThrow('no answer from the inspector within 50 ms');
    expect(socket.closes).toBe(1);
  });

  it('rejects when the debugger URL fails', async () => {
    server = await inspector(() => undefined, () => [{ type: 'page', webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/X' }]);
    await expect(evaluateOnPort(server.port, '1', { timeoutMs: 5000 })).rejects.toThrow("the inspector's WebSocket failed (ws://127.0.0.1:1/devtools/page/X)");
  });
});
