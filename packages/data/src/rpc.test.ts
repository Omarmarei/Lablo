import { afterEach, describe, expect, it } from 'vitest';
import type { RpcContext, RpcPort } from './rpc';
import { CancelError, CancelSource, NEVER, RpcClient, RpcError, serveRpc } from './rpc';

const opened: MessagePort[] = [];
afterEach(() => {
  for (const port of opened.splice(0)) port.close();
});

/** A connected port pair (Node's MessageChannel: real structured clone and transfer). */
function channel(): [RpcPort, RpcPort] {
  const { port1, port2 } = new MessageChannel();
  opened.push(port1, port2);
  return [port1, port2];
}

class CodedError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'CodedError';
  }
}

/** Resolves after `ms`; used where a handler must still be running. */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function setup() {
  const seen: { cancelledAt: string | null } = { cancelledAt: null };
  let release: () => void = () => undefined;
  const handlers = {
    add: (arg: { a: number; b: number }) => arg.a + arg.b,
    later: async (arg: { text: string }) => {
      await sleep(5);
      return arg.text.toUpperCase();
    },
    nothing: () => undefined,
    fails: (arg: { how: 'coded' | 'plain' | 'string' | 'reject' }): unknown => {
      if (arg.how === 'coded') throw new CodedError('bad source', 'auth-failed');
      if (arg.how === 'plain') throw new TypeError('wrong type');
      if (arg.how === 'reject') return Promise.reject(new CodedError('async bad', 'async'));
      throw 'just a string';
    },
    slow: (_arg: undefined, ctx: RpcContext) =>
      new Promise<string>((resolve) => {
        ctx.token.onCancel(() => {
          seen.cancelledAt = 'during';
          resolve('too late');
        });
        release = () => resolve('done');
      }),
    progress: async (arg: { steps: number }, ctx: RpcContext) => {
      for (let i = 1; i <= arg.steps; i++) ctx.emit('progress', { step: i });
      return 'finished';
    },
    buffer: (arg: { size: number }, ctx: RpcContext) => {
      const data = new Uint8Array(arg.size).fill(7);
      ctx.transfer(data.buffer);
      return data;
    },
    unclonable: () => ({ fn: () => 1 }),
  };
  const [serverPort, clientPort] = channel();
  const server = serveRpc(serverPort, handlers);
  const client = new RpcClient<typeof handlers, { progress: { step: number } }>(clientPort);
  return { server, client, clientPort, seen, release: () => release() };
}

describe('RPC', () => {
  it('calls typed handlers, sync and async, and keeps calls apart by id', async () => {
    const { client } = setup();
    const results = await Promise.all([client.call('later', { text: 'b' }), client.call('add', { a: 2, b: 3 }), client.call('nothing')]);
    expect(results).toEqual(['B', 5, undefined]);
    expect(client.inFlight).toBe(0);
  });

  it('carries errors across with their code', async () => {
    const { client } = setup();
    const coded = await client.call('fails', { how: 'coded' }).catch((e: unknown) => e);
    expect(coded).toBeInstanceOf(RpcError);
    expect(coded).toMatchObject({ message: 'bad source', code: 'auth-failed', remoteName: 'CodedError' });
    await expect(client.call('fails', { how: 'plain' })).rejects.toMatchObject({ code: 'TypeError', message: 'wrong type' });
    await expect(client.call('fails', { how: 'reject' })).rejects.toMatchObject({ code: 'async', message: 'async bad' });
    await expect(client.call('fails', { how: 'string' })).rejects.toMatchObject({ code: 'Error', message: 'just a string' });
    // A method the server doesn't have, even one on Object.prototype.
    const anyClient = client as unknown as RpcClient<Record<string, () => unknown>>;
    await expect(anyClient.call('nope')).rejects.toMatchObject({ code: 'unknown-method' });
    await expect(anyClient.call('toString')).rejects.toMatchObject({ code: 'unknown-method' });
    // A result that can't be cloned becomes an error instead of a hung call.
    await expect(client.call('unclonable')).rejects.toMatchObject({ code: 'DataCloneError' });
  });

  it('cancels: the call rejects at once, the handler sees the token, the late reply is dropped', async () => {
    const { client, clientPort, seen } = setup();
    const replies: unknown[] = [];
    clientPort.addEventListener('message', (event) => replies.push(event.data));
    const source = new CancelSource();
    const call = client.call('slow', undefined, { cancel: source.token });
    await sleep(5);
    expect(client.inFlight).toBe(1);
    source.cancel();
    await expect(call).rejects.toBeInstanceOf(CancelError);
    expect(client.inFlight).toBe(0);
    await sleep(10);
    expect(seen.cancelledAt).toBe('during');
    // The handler finished ('too late') after the cancel, and the server sent no reply for it.
    expect(replies).toEqual([]);
    // Already cancelled: never sent.
    await expect(client.call('add', { a: 1, b: 1 }, { cancel: source.token })).rejects.toBeInstanceOf(CancelError);
    // A token that was never cancelled changes nothing.
    await expect(client.call('add', { a: 1, b: 1 }, { cancel: NEVER })).resolves.toBe(2);
  });

  it('settles normally when the handler finishes before a cancel', async () => {
    const { client, release } = setup();
    const source = new CancelSource();
    const call = client.call('slow', undefined, { cancel: source.token });
    await sleep(5);
    release();
    await expect(call).resolves.toBe('done');
    source.cancel(); // too late to matter
  });

  it('delivers server events to listeners until they unsubscribe', async () => {
    const { client, server } = setup();
    const steps: number[] = [];
    const off = client.on('progress', (p) => steps.push(p.step));
    await expect(client.call('progress', { steps: 3 })).resolves.toBe('finished');
    server.emit('progress', { step: 99 });
    await sleep(5);
    off();
    server.emit('progress', { step: 100 });
    await sleep(5);
    expect(steps).toEqual([1, 2, 3, 99]);
  });

  it('transfers buffers instead of copying them', async () => {
    const { client } = setup();
    const result = await client.call('buffer', { size: 1024 });
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.byteLength).toBe(1024);
    expect(result[1023]).toBe(7);
    // Client side: a transferred argument leaves the sender detached.
    const [a, b] = channel();
    const echo = serveRpc(a, { len: (arg: { data: Uint8Array }) => arg.data.byteLength });
    const client2 = new RpcClient<{ len: (arg: { data: Uint8Array }) => number }>(b);
    const data = new Uint8Array(64);
    await expect(client2.call('len', { data }, { transfer: [data.buffer] })).resolves.toBe(64);
    expect(data.byteLength).toBe(0);
    echo.close();
  });

  it('rejects pending and later calls when the worker fails, and after close', async () => {
    const { client } = setup();
    const call = client.call('slow');
    client.fail(new Error('worker crashed'));
    await expect(call).rejects.toThrow('worker crashed');
    await expect(client.call('add', { a: 1, b: 2 })).rejects.toThrow('worker crashed');

    const second = setup();
    const pending = second.client.call('slow');
    second.client.close();
    await expect(pending).rejects.toMatchObject({ code: 'closed' });
  });

  it('stops answering after the server closes, and cancels what was running', async () => {
    const { client, server, seen } = setup();
    const call = client.call('slow');
    await sleep(5);
    server.close();
    expect(seen.cancelledAt).toBe('during');
    const late = await Promise.race([call.then(() => 'answered'), sleep(20).then(() => 'silent')]);
    expect(late).toBe('silent');
    client.fail(new Error('gave up'));
    await expect(call).rejects.toThrow('gave up');
  });

  it('ignores messages that are not RPC messages', async () => {
    const [serverPort, clientPort] = channel();
    serveRpc(serverPort, { ping: () => 'pong' });
    const client = new RpcClient<{ ping: () => string }>(clientPort);
    clientPort.postMessage({ hello: 'world' });
    clientPort.postMessage(null);
    serverPort.postMessage({ zr: 1, t: 'ok', id: 999, v: 'stray' });
    await expect(client.call('ping')).resolves.toBe('pong');
  });
});

describe('CancelSource', () => {
  it('runs listeners once, immediately for late subscribers, and supports unsubscribing', () => {
    const source = new CancelSource();
    const calls: string[] = [];
    source.token.onCancel(() => calls.push('a'));
    const off = source.token.onCancel(() => calls.push('b'));
    off();
    expect(source.token.cancelled).toBe(false);
    expect(() => source.token.throwIfCancelled()).not.toThrow();
    source.cancel();
    source.cancel();
    source.token.onCancel(() => calls.push('late'));
    expect(calls).toEqual(['a', 'late']);
    expect(source.cancelled).toBe(true);
    expect(() => source.token.throwIfCancelled()).toThrow(CancelError);
    expect(NEVER.cancelled).toBe(false);
  });
});
