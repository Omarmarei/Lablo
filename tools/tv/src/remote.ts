/**
 * Samsung's remote-control channel (`wss://<tv>:8002/api/v2/channels/samsung.remote.control`):
 * the messages that press a key and type text, the events the TV sends, and a script of keys,
 * pauses and text as the Samsung session's `tvraw.mjs` took them (RELAY step 39s6).
 *
 * The first connection under a client name shows an "Allow" prompt on the TV; the TV then answers
 * `ms.channel.connect` with a token, and a later connection that sends it gets no prompt.
 */
import type { RawWebSocket } from './ws';

export const REMOTE_PORT = 8002;

/** The channel's path: the client's name in base64, and the token from an earlier connection. */
export function remotePath(name: string, token: string | undefined): string {
  const base = `/api/v2/channels/samsung.remote.control?name=${Buffer.from(name).toString('base64')}`;
  return token === undefined || token === '' ? base : `${base}&token=${encodeURIComponent(token)}`;
}

/** A key press (`KEY_ENTER`, `KEY_CHUP`...). */
export function keyMessage(key: string): string {
  return JSON.stringify({ method: 'ms.remote.control', params: { Cmd: 'Click', DataOfCmd: key, Option: 'false', TypeOfRemote: 'SendRemoteKey' } });
}

/** Text for the TV's on-screen keyboard; the TV takes it only while the keyboard is up (`ms.remote.imeStart`). */
export function textMessage(text: string): string {
  return JSON.stringify({ method: 'ms.remote.control', params: { Cmd: Buffer.from(text).toString('base64'), DataOfCmd: 'base64', TypeOfRemote: 'SendInputString' } });
}

/** Closes the on-screen keyboard as its "Done" would. */
export function inputEndMessage(): string {
  return JSON.stringify({ method: 'ms.remote.control', params: { TypeOfRemote: 'SendInputEnd' } });
}

export type RemoteEvent =
  | { readonly type: 'connect'; readonly token: string | null }
  | { readonly type: 'unauthorized' }
  | { readonly type: 'ime-start' }
  | { readonly type: 'ime-end' }
  | { readonly type: 'other'; readonly event: string };

/** What a message from the TV means (`other` for anything this tool doesn't act on). */
export function remoteEvent(text: string): RemoteEvent {
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return { type: 'other', event: '(not JSON)' };
  }
  if (typeof message !== 'object' || message === null) return { type: 'other', event: '(not an object)' };
  const { event, data } = message as { event?: unknown; data?: unknown };
  switch (event) {
    case 'ms.channel.connect': {
      const token = typeof data === 'object' && data !== null ? (data as { token?: unknown }).token : undefined;
      return { type: 'connect', token: typeof token === 'string' || typeof token === 'number' ? String(token) : null };
    }
    case 'ms.channel.unauthorized':
      return { type: 'unauthorized' };
    case 'ms.remote.imeStart':
      return { type: 'ime-start' };
    case 'ms.remote.imeEnd':
      return { type: 'ime-end' };
    default:
      return { type: 'other', event: typeof event === 'string' ? event : '(no event)' };
  }
}

export type ScriptStep =
  | { readonly kind: 'key'; readonly key: string }
  | { readonly kind: 'pause'; readonly ms: number }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'end' };

/**
 * A script from its tokens: `KEY_X` presses a key, a number waits that many milliseconds,
 * `TEXT:<s>` types `<s>` (the rest of the token, spaces included if the shell kept them), `END`
 * closes the keyboard. An unknown token is an error before anything is sent.
 */
export function parseScript(tokens: readonly string[]): ScriptStep[] | string {
  const steps: ScriptStep[] = [];
  for (const token of tokens) {
    if (/^\d+$/.test(token)) steps.push({ kind: 'pause', ms: Number(token) });
    else if (token.startsWith('TEXT:')) steps.push({ kind: 'text', text: token.slice('TEXT:'.length) });
    else if (token === 'END') steps.push({ kind: 'end' });
    else if (/^KEY_[A-Z0-9_]+$/.test(token)) steps.push({ kind: 'key', key: token });
    else return `"${token}" is not a key (KEY_...), a pause in ms, TEXT:<text> or END`;
  }
  return steps;
}

/** The pauses tvraw.mjs kept after each message, so the TV's UI keeps up. */
export const AFTER_KEY_MS = 500;
export const AFTER_TEXT_MS = 800;

/** Sends a script's steps in order, with the pauses above, and reports each step. */
export async function runScript(
  ws: Pick<RawWebSocket, 'send'>,
  steps: readonly ScriptStep[],
  sleep: (ms: number) => Promise<void>,
  log: (line: string) => void,
): Promise<void> {
  for (const step of steps) {
    switch (step.kind) {
      case 'pause':
        await sleep(step.ms);
        break;
      case 'key':
        ws.send(keyMessage(step.key));
        log(`sent ${step.key}`);
        await sleep(AFTER_KEY_MS);
        break;
      case 'text':
        ws.send(textMessage(step.text));
        log(`typed ${step.text.length} characters`);
        await sleep(AFTER_TEXT_MS);
        break;
      case 'end':
        ws.send(inputEndMessage());
        log('closed the keyboard');
        await sleep(AFTER_TEXT_MS);
        break;
    }
  }
}
