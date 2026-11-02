/**
 * Typed request/response RPC over `postMessage` between the UI thread and the data workers
 * (architecture.md §1.2: no comlink). Works over anything with `postMessage` and `message`
 * events: a Worker, a worker's `self`, a MessagePort.
 *
 * - Every call carries an id; the reply settles that call's promise.
 * - Errors cross as `{ name, message, code }` and are rethrown as `RpcError` (or `CancelError`).
 * - Cancellation uses our own tokens (Chromium 53 has no AbortController): cancelling rejects the
 *   call at once with `CancelError` and tells the other side, whose handler sees
 *   `ctx.token.cancelled` and can stop early. Its eventual reply is dropped.
 * - The server can push events (`ctx.emit` or `server.emit`), e.g. ingest progress.
 * - Results can transfer buffers instead of copying them (`ctx.transfer`).
 *
 * Messages are plain objects tagged `zr: 1`; anything else on the port is ignored.
 */

/** What both ends need from a Worker, worker `self` or MessagePort. */
export interface RpcPort {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  /** MessagePorts deliver nothing until started. */
  start?: () => void;
}

// ---------------------------------------------------------------------------------------------
// Cancellation

export class CancelError extends Error {
  readonly code = 'cancelled';
  constructor(message = 'Cancelled') {
    super(message);
    this.name = 'CancelError';
  }
}

export interface CancelToken {
  readonly cancelled: boolean;
  /** Runs `listener` once on cancel (at once if already cancelled). Returns an unsubscribe. */
  onCancel(listener: () => void): () => void;
  /** Throws `CancelError` if cancelled. */
  throwIfCancelled(): void;
}

interface CancelState {
  done: boolean;
  listeners: (() => void)[];
}

class Token implements CancelToken {
  constructor(private readonly state: CancelState) {}

  get cancelled(): boolean {
    return this.state.done;
  }

  onCancel(listener: () => void): () => void {
    const state = this.state;
    if (state.done) {
      listener();
      return () => undefined;
    }
    state.listeners.push(listener);
    return () => {
      const i = state.listeners.indexOf(listener);
      if (i !== -1) state.listeners.splice(i, 1);
    };
  }

  throwIfCancelled(): void {
    if (this.state.done) throw new CancelError();
  }
}

/** Owns a token and cancels it. */
export class CancelSource {
  private readonly state: CancelState = { done: false, listeners: [] };
  readonly token: CancelToken = new Token(this.state);

  get cancelled(): boolean {
    return this.state.done;
  }

  cancel(): void {
    if (this.state.done) return;
    this.state.done = true;
    const listeners = this.state.listeners;
    this.state.listeners = [];
    for (const l of listeners) l();
  }
}

/** A token that is never cancelled. */
export const NEVER: CancelToken = new Token({ done: false, listeners: [] });

// ---------------------------------------------------------------------------------------------
// Wire format

interface CallMsg {
  zr: 1;
  t: 'call';
  id: number;
  m: string;
  a: unknown;
}
interface CancelMsg {
  zr: 1;
  t: 'cancel';
  id: number;
}
interface OkMsg {
  zr: 1;
  t: 'ok';
  id: number;
  v: unknown;
}
interface ErrMsg {
  zr: 1;
  t: 'err';
  id: number;
  e: WireError;
}
interface EventMsg {
  zr: 1;
  t: 'event';
  n: string;
  v: unknown;
}
type Msg = CallMsg | CancelMsg | OkMsg | ErrMsg | EventMsg;

interface WireError {
  name: string;
  message: string;
  code: string;
}

function isMsg(data: unknown): data is Msg {
  return typeof data === 'object' && data !== null && (data as { zr?: unknown }).zr === 1;
}

/** An error thrown on the other side of the port. */
export class RpcError extends Error {
  constructor(
    message: string,
    /** Machine-readable code: the thrown error's `code`, or its name. */
    readonly code: string,
    /** The original error's name. */
    readonly remoteName: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

function toWire(error: unknown): WireError {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return { name: error.name, message: error.message, code: typeof code === 'string' ? code : error.name };
  }
  return { name: 'Error', message: String(error), code: 'Error' };
}

function fromWire(e: WireError): Error {
  if (e.code === 'cancelled' && e.name === 'CancelError') return new CancelError(e.message);
  return new RpcError(e.message, e.code, e.name);
}

// ---------------------------------------------------------------------------------------------
// Server

export interface RpcContext {
  /** Cancelled when the caller cancels this call. */
  readonly token: CancelToken;
  /** Transfers these buffers with the result instead of copying them. */
  transfer(...list: Transferable[]): void;
  /** Pushes an event to the client. */
  emit(name: string, value: unknown): void;
}

/** A handler takes one argument (use `undefined` for none) and the call context. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RpcHandler = (arg: any, ctx: RpcContext) => unknown;
export type RpcHandlers = Record<string, RpcHandler>;

export interface RpcServer {
  emit(name: string, value: unknown, transfer?: Transferable[]): void;
  /** Stops answering; calls still running are cancelled. */
  close(): void;
}

/** Answers calls arriving on `port` with `handlers`. */
export function serveRpc(port: RpcPort, handlers: RpcHandlers): RpcServer {
  const running = new Map<number, CancelSource>();
  let closed = false;

  const send = (msg: Msg, transfer?: Transferable[]): void => {
    try {
      port.postMessage(msg, transfer ?? []);
    } catch (error) {
      // Most likely a result that can't be cloned (a function, a DOM node): report that instead.
      if (msg.t === 'ok') port.postMessage({ zr: 1, t: 'err', id: msg.id, e: toWire(error) } satisfies ErrMsg);
      else throw error;
    }
  };

  const emit = (name: string, value: unknown, transfer?: Transferable[]): void => {
    if (!closed) send({ zr: 1, t: 'event', n: name, v: value }, transfer);
  };

  const call = (msg: CallMsg): void => {
    const source = new CancelSource();
    running.set(msg.id, source);
    const transfer: Transferable[] = [];
    const ctx: RpcContext = {
      token: source.token,
      transfer: (...list) => {
        transfer.push(...list);
      },
      emit: (name, value) => emit(name, value),
    };
    const finish = (reply: OkMsg | ErrMsg): void => {
      running.delete(msg.id);
      if (closed || source.cancelled) return;
      send(reply, reply.t === 'ok' ? transfer : undefined);
    };
    let result: unknown;
    try {
      const handler = Object.prototype.hasOwnProperty.call(handlers, msg.m) ? handlers[msg.m] : undefined;
      if (typeof handler !== 'function') throw new RpcError(`Unknown method ${msg.m}`, 'unknown-method', 'RpcError');
      result = handler(msg.a, ctx);
    } catch (error) {
      finish({ zr: 1, t: 'err', id: msg.id, e: toWire(error) });
      return;
    }
    Promise.resolve(result).then(
      (v) => finish({ zr: 1, t: 'ok', id: msg.id, v }),
      (error: unknown) => finish({ zr: 1, t: 'err', id: msg.id, e: toWire(error) }),
    );
  };

  const listener = (event: MessageEvent): void => {
    const data: unknown = event.data;
    if (closed || !isMsg(data)) return;
    if (data.t === 'call') call(data);
    else if (data.t === 'cancel') running.get(data.id)?.cancel();
  };
  port.addEventListener('message', listener);
  port.start?.();

  return {
    emit,
    close: () => {
      if (closed) return;
      closed = true;
      port.removeEventListener('message', listener);
      for (const source of running.values()) source.cancel();
      running.clear();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Client

export interface CallOptions {
  /** Cancels the call (rejects with `CancelError`). */
  cancel?: CancelToken;
  /** Transfers these buffers with the argument instead of copying them. */
  transfer?: Transferable[];
}

type ArgOf<H> = H extends (arg: infer A, ctx: RpcContext) => unknown ? A : never;
type ResultOf<H> = H extends (arg: never, ctx: RpcContext) => infer R ? Awaited<R> : never;
/** Methods whose argument can be left out. */
type CallArgs<H> = undefined extends ArgOf<H> ? [arg?: ArgOf<H>, options?: CallOptions] : [arg: ArgOf<H>, options?: CallOptions];

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  unsubscribe(): void;
}

/** Calls the handlers `H` served on the other side of `port`. */
export class RpcClient<H extends RpcHandlers, E extends Record<string, unknown> = Record<string, unknown>> {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, ((value: never) => void)[]>();
  private failure: Error | null = null;
  private readonly listener = (event: MessageEvent): void => this.receive(event.data);

  constructor(private readonly port: RpcPort) {
    port.addEventListener('message', this.listener);
    port.start?.();
  }

  /** Calls `method`. Rejects with the remote error, `CancelError`, or the error `fail` got. */
  call<K extends keyof H & string>(method: K, ...args: CallArgs<H[K]>): Promise<ResultOf<H[K]>> {
    const [arg, options] = args as [unknown, CallOptions | undefined];
    const token = options?.cancel;
    if (this.failure) return Promise.reject(this.failure);
    if (token?.cancelled) return Promise.reject(new CancelError());
    const id = this.nextId++;
    return new Promise<ResultOf<H[K]>>((resolve, reject) => {
      const unsubscribe = token
        ? token.onCancel(() => {
            if (!this.pending.delete(id)) return;
            reject(new CancelError());
            try {
              this.port.postMessage({ zr: 1, t: 'cancel', id } satisfies CancelMsg);
            } catch {
              // The port is gone; nothing to tell.
            }
          })
        : () => undefined;
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, unsubscribe });
      try {
        this.port.postMessage({ zr: 1, t: 'call', id, m: method, a: arg } satisfies CallMsg, options?.transfer ?? []);
      } catch (error) {
        this.pending.delete(id);
        unsubscribe();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Listens to a server event. Returns an unsubscribe. */
  on<K extends keyof E & string>(name: K, listener: (value: E[K]) => void): () => void {
    const list = this.listeners.get(name) ?? [];
    list.push(listener as (value: never) => void);
    this.listeners.set(name, list);
    return () => {
      const i = list.indexOf(listener as (value: never) => void);
      if (i !== -1) list.splice(i, 1);
    };
  }

  /** Rejects every pending and future call with `error` (the worker died). */
  fail(error: Error): void {
    this.failure = error;
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const p of pending) {
      p.unsubscribe();
      p.reject(error);
    }
  }

  /** Stops listening; pending calls reject. */
  close(): void {
    this.port.removeEventListener('message', this.listener);
    this.fail(new RpcError('RPC client closed', 'closed', 'RpcError'));
  }

  /** Calls waiting for a reply. */
  get inFlight(): number {
    return this.pending.size;
  }

  private receive(data: unknown): void {
    if (!isMsg(data)) return;
    if (data.t === 'event') {
      const list = this.listeners.get(data.n);
      if (list) for (const l of list.slice()) (l as (value: unknown) => void)(data.v);
      return;
    }
    if (data.t !== 'ok' && data.t !== 'err') return;
    const p = this.pending.get(data.id);
    if (!p) return; // cancelled or failed already
    this.pending.delete(data.id);
    p.unsubscribe();
    if (data.t === 'ok') p.resolve(data.v);
    else p.reject(fromWire(data.e));
  }
}
