/**
 * A minimal Chrome DevTools Protocol client over Node's built-in WebSocket.
 *
 * Playwright and current Puppeteer need a recent protocol, and Puppeteer 1.x starts at
 * Chromium 66, so neither reaches Chromium 53. The harness only needs a handful of methods that
 * exist in every engine it drives: Page.navigate, Runtime.evaluate, Input.dispatchKeyEvent and
 * the Runtime.exceptionThrown event.
 */

interface Pending {
  readonly method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

export class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, Array<(params: unknown) => void>>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => this.onMessage(String(event.data)));
    socket.addEventListener('close', () => this.failAll(new Error('DevTools connection closed')));
  }

  static connect(url: string, timeoutMs = 10_000): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`DevTools WebSocket ${url} did not open within ${timeoutMs} ms`));
      }, timeoutMs);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(new CdpClient(socket));
      });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error(`DevTools WebSocket ${url} failed to open`));
      });
    });
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve: resolve as (value: unknown) => void, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event: string, listener: (params: unknown) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }

  off(event: string, listener: (params: unknown) => void): void {
    this.listeners.set(
      event,
      (this.listeners.get(event) ?? []).filter((candidate) => candidate !== listener),
    );
  }

  close(): void {
    this.socket.close();
  }

  private onMessage(text: string): void {
    const message = JSON.parse(text) as CdpMessage;
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (pending === undefined) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error !== undefined) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result);
      return;
    }
    if (message.method !== undefined) {
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
    }
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until the engine's DevTools HTTP endpoint answers; returns `/json/version`. */
export async function waitForDevtools(port: number, timeoutMs: number): Promise<{ Browser: string; 'User-Agent'?: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no answer';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return (await response.json()) as { Browser: string };
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(250);
  }
  throw new Error(`DevTools on port ${port} did not answer within ${timeoutMs} ms (${lastError})`);
}

interface TargetInfo {
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

/**
 * The WebSocket URL of the first page target. The engine reports its own address
 * (127.0.0.1:9222 inside the container); it is rewritten to the published host port.
 */
export function pageSocketUrl(targets: readonly TargetInfo[], port: number): string {
  const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl !== undefined);
  if (page?.webSocketDebuggerUrl === undefined) throw new Error('the engine reported no page target');
  const url = new URL(page.webSocketDebuggerUrl);
  url.hostname = '127.0.0.1';
  url.port = String(port);
  return url.toString();
}

export async function connectToPage(port: number): Promise<CdpClient> {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  const targets = (await response.json()) as TargetInfo[];
  return CdpClient.connect(pageSocketUrl(targets, port));
}
