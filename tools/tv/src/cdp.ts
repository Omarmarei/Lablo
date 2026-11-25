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

interface InspectorTarget {
  readonly type?: string;
  readonly id?: string;
  readonly webSocketDebuggerUrl?: string;
}

/** The page's debugger URL from the inspector's `/json` list (the first page, else the first target). */
export function pageTarget(list: unknown, port: number): string | null {
  if (!Array.isArray(list)) return null;
  const targets = list.filter((item): item is InspectorTarget => typeof item === 'object' && item !== null);
  const target = targets.find((item) => item.type === 'page') ?? targets[0];
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

/**
 * Evaluates `expression` in the TV page on a forwarded inspector port (promises awaited).
 *
 * Each path settles first and closes after, and the error path never closes: on Node 22 a
 * `close()` of a socket that never opened fires `error` again from inside `close()`, so an error
 * handler that closed called itself until the stack ran out (PR #179's first CI run).
 */
export async function evaluateOnPort(
  port: number,
  expression: string,
  timeoutMs = 60_000,
  open: (url: string) => InspectorSocket = (url) => new WebSocket(url),
): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(timeoutMs) });
  const url = pageTarget(await response.json(), port);
  if (url === null) throw new Error(`no page on the inspector at port ${port}`);
  return new Promise((resolve, reject) => {
    const ws = open(url);
    const timer = setTimeout(() => {
      reject(new Error(`no answer from the inspector within ${timeoutMs} ms`));
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
      reject(new Error(`the inspector's WebSocket failed (${url})`));
    });
  });
}
