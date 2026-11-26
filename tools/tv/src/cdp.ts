/**
 * The TV page's inspector (Chrome DevTools Protocol) after `sdb forward tcp:P tcp:P` on Tizen or
 * `ares-inspect` on webOS: one `Runtime.evaluate` per call, over Node's built-in `WebSocket`
 * (which the inspector answers, unlike the TV's remote API). `Page.captureScreenshot` never
 * answers on Tizen 5.5, so this tool reads the page instead of capturing it (RELAY step 39s6).
 */

/** The port `sdb shell 0 debug <appid>` prints (`... port: 37201`), or null. A new one per launch. */
export function parseDebugPort(output: string): number | null {
  const port = Number(/\bport\s*:\s*(\d+)/i.exec(output)?.[1] ?? Number.NaN);
  return port >= 1 && port <= 65_535 ? port : null;
}

/** The TV's inspector serves one client at a time (a second one is refused or never answered). */
export const ONE_CLIENT = "The TV's inspector allows one client at a time: close Chrome's DevTools (chrome://inspect) and any other `pnpm tv` that holds it.";

interface InspectorTarget {
  readonly type?: string;
  readonly id?: string;
  readonly url?: string;
  readonly webSocketDebuggerUrl?: string;
}

function targetsOf(list: unknown): InspectorTarget[] {
  return Array.isArray(list) ? list.filter((item): item is InspectorTarget => typeof item === 'object' && item !== null) : [];
}

/**
 * The page's debugger URL from the inspector's `/json` list: the first page, else the first
 * target. With `page` (webOS, RELAY step 56: the TV's inspector lists every page of its web
 * runtime), only a page whose URL holds it.
 */
export function pageTarget(list: unknown, port: number, page?: string): string | null {
  const targets = targetsOf(list);
  const target = page === undefined ? (targets.find((item) => item.type === 'page') ?? targets[0]) : targets.find((item) => item.type === 'page' && typeof item.url === 'string' && item.url.includes(page));
  if (target === undefined) return null;
  if (typeof target.webSocketDebuggerUrl === 'string') return target.webSocketDebuggerUrl;
  return typeof target.id === 'string' ? `ws://127.0.0.1:${port}/devtools/page/${target.id}` : null;
}

/** A `Runtime.evaluate` answer: its value, or the page's exception as text. */
export function evaluateResult(message: unknown): { readonly value: unknown } | { readonly error: string } {
  const { result, error } = (message ?? {}) as { result?: unknown; error?: unknown };
  if (error !== undefined) return { error: `inspector error: ${JSON.stringify(error)}` };
  const { result: remote, exceptionDetails } = (result ?? {}) as { result?: { value?: unknown }; exceptionDetails?: unknown };
  if (exceptionDetails !== undefined) {
    const details = exceptionDetails as { text?: unknown; exception?: { description?: unknown } };
    const description = details.exception?.description;
    return { error: `the page threw: ${typeof description === 'string' ? description : String(details.text)}` };
  }
  return { value: remote?.value };
}

/** The part of a WebSocket the inspector client uses (Node's built-in one, or a test's). */
export interface InspectorSocket {
  addEventListener(type: 'open' | 'error', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  send(data: string): void;
  close(): void;
}

export interface EvaluateOptions {
  /** How long the inspector may take (default 60 s). */
  readonly timeoutMs?: number;
  /** Opens the page's socket (Node's built-in `WebSocket`, or a test's). */
  readonly open?: (url: string) => InspectorSocket;
  /** Only a page whose URL holds this (webOS: `webosPage`). */
  readonly page?: string;
}

/**
 * Evaluates `expression` in the TV page on a forwarded inspector port (promises awaited).
 *
 * Each path settles first and closes after, and the error path never closes: on Node 22 a
 * `close()` of a socket that never opened fires `error` again from inside `close()`, so an error
 * handler that closed called itself until the stack ran out (PR #179's first CI run).
 */
export async function evaluateOnPort(port: number, expression: string, options: EvaluateOptions = {}): Promise<unknown> {
  const { timeoutMs = 60_000, open = (url: string): InspectorSocket => new WebSocket(url), page } = options;
  const response = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(timeoutMs) });
  const list: unknown = await response.json();
  const url = pageTarget(list, port, page);
  if (url === null && page !== undefined) {
    const pages = targetsOf(list).map((item) => item.url ?? item.id ?? '?');
    throw new Error(`no page of ${page} on the inspector at port ${port} (is the app running?); it lists: ${pages.length === 0 ? 'nothing' : pages.join(', ')}`);
  }
  if (url === null) throw new Error(`no page on the inspector at port ${port}`);
  return new Promise((resolve, reject) => {
    const ws = open(url);
    const timer = setTimeout(() => {
      reject(new Error(`no answer from the inspector within ${timeoutMs} ms. ${ONE_CLIENT}`));
      ws.close();
    }, timeoutMs);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { id?: unknown };
      if (message.id !== 1) return;
      const answer = evaluateResult(message);
      clearTimeout(timer);
      if ('error' in answer) reject(new Error(answer.error));
      else resolve(answer.value);
      ws.close();
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error(`the inspector's WebSocket failed (${url}). ${ONE_CLIENT}`));
    });
  });
}
