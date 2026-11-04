/**
 * S10 from docs/architecture.md §5: input. Do the number, CH, colour and media keys reach the
 * app (Tizen registers them, `Platform.registerKeys`), and with which codes? PRE-CH, Back, the
 * Magic Remote pointer, and the TV's own keyboard typing Arabic and English into the app's text
 * field (`TextField`, `createTextEditor`: DOM focus opens it)? If the keyboard is unusable, the
 * plan's fallback is an on-screen keyboard of our own (+2 sessions).
 *
 * Only the registration runs unattended. The key tester, the pointer and the keyboard need a
 * person, so they run only when S10 is started from its row (`LabContext.interactive`).
 */
import type { Intent, KeyRegistration, PlatformId } from '@zoma/platform-api';
import { INTENTS } from '@zoma/platform-api';
import type { Check, CheckResult, KeyPress, KeyTestResult, LabContext, PointerLog, Spike, TextTestResult } from '../types';

/** How long the key tester and the keyboard test wait for a person. */
export const INPUT_TIMEOUT_MS = 5 * 60_000;

/** The registration's result: Tizen must take every key it has; the others have nothing to do. */
export function registrationResult(platform: PlatformId, keys: KeyRegistration): CheckResult {
  const value = keys;
  if (platform !== 'tizen') return { status: platform === 'browser' ? 'skip' : 'info', value, note: keys.skipped ?? 'nothing to register' };
  if (keys.skipped !== null) return { status: 'fail', value, note: keys.skipped };
  if (keys.refused.length > 0) return { status: 'fail', value, note: `the TV refused ${keys.refused.map((r) => `${r.name} (${r.error})`).join(', ')}` };
  const list = keys.supported === null ? '; the TV gave no key list, so every key was tried' : '';
  const missing = keys.unsupported.length === 0 ? '' : `; not on this TV: ${keys.unsupported.join(', ')}`;
  return { status: 'pass', value, note: `registered ${keys.registered.length} keys${list}${missing}` };
}

/** One distinct key the tester saw, how often, and what the adapter made of it. */
export interface SeenKey {
  readonly keyCode: number;
  readonly key: string;
  readonly intent: Intent | null;
  readonly count: number;
}

/** The distinct keys in the order they first came. */
export function distinctKeys(presses: readonly KeyPress[]): SeenKey[] {
  const keys: SeenKey[] = [];
  for (const press of presses) {
    const i = keys.findIndex((k) => k.keyCode === press.keyCode && k.key === press.key);
    const seen = keys[i];
    if (seen === undefined) keys.push({ keyCode: press.keyCode, key: press.key, intent: press.intent, count: 1 });
    else keys[i] = { ...seen, count: seen.count + 1 };
  }
  return keys;
}

const codeText = (k: SeenKey): string => `${k.keyCode}${k.key === '' ? '' : ` ${k.key}`}`;

/**
 * The key tester's result: `pass` when a key came for every Intent, `fail` naming the missing
 * ones; `skip` when nobody pressed anything but Back.
 */
export function keysResult(result: KeyTestResult, intents: readonly Intent[]): CheckResult {
  const keys = distinctKeys(result.presses);
  const codes: Partial<Record<Intent, number[]>> = {};
  for (const k of keys) if (k.intent !== null) (codes[k.intent] ??= []).push(k.keyCode);
  const missing = intents.filter((intent) => codes[intent] === undefined);
  const others = keys.filter((k) => k.intent === null);
  const value = { ended: result.ended, presses: result.presses.length, codes, missing, others, keys };
  if (result.presses.every((p) => p.intent === 'BACK')) {
    return { status: 'skip', value, note: result.ended === 'timeout' ? `no key within ${INPUT_TIMEOUT_MS / 60_000} minutes` : 'skipped with Back' };
  }
  const extra = others.length === 0 ? '' : `; keys with no action: ${others.map(codeText).join(', ')}`;
  if (missing.length === 0) return { status: 'pass', value, note: `every key came (${intents.length})${extra}` };
  return { status: 'fail', value, note: `no key for ${missing.join(', ')}${extra}` };
}

/** The pointer while the key tester was open: `pass` when it moved and clicked. */
export function pointerResult(pointer: PointerLog): CheckResult {
  const value = pointer;
  const text = `shown ${pointer.shown}, hidden ${pointer.hidden}, moves ${pointer.moves}, clicks ${pointer.clicks}, wheel ${pointer.wheel}`;
  if (pointer.shown + pointer.hidden + pointer.moves + pointer.clicks + pointer.wheel === 0) {
    return { status: 'skip', value, note: 'no pointer in the key tester (no Magic Remote, or it stayed still)' };
  }
  return { status: pointer.moves > 0 && pointer.clicks > 0 ? 'pass' : 'info', value, note: text };
}

const inRange = (code: number, from: number, to: number): boolean => code >= from && code <= to;

/** Which scripts a text has letters of: Arabic (the letters of the Arabic blocks and presentation forms; not the tatweel), Latin (A–Z). */
export function scriptsOf(text: string): { readonly arabic: boolean; readonly latin: boolean } {
  let arabic = false;
  let latin = false;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (inRange(code, 0x0620, 0x063f) || inRange(code, 0x0641, 0x064a) || inRange(code, 0x0671, 0x06d3) || inRange(code, 0x0750, 0x077f) || inRange(code, 0xfb50, 0xfdff) || inRange(code, 0xfe70, 0xfefc)) arabic = true;
    else if (inRange(code, 0x41, 0x5a) || inRange(code, 0x61, 0x7a)) latin = true;
  }
  return { arabic, latin };
}

/**
 * The keyboard test's result: GREEN with Arabic and Latin letters typed is a `pass`; GREEN
 * without one of them, or RED, a `fail`; Back or no answer a `skip`.
 */
export function keyboardResult(result: TextTestResult): CheckResult {
  const scripts = scriptsOf(result.text);
  const value = { ...result, scripts };
  const typed = result.text === '' ? 'nothing typed' : `typed "${result.text}"`;
  switch (result.answer) {
    case 'yes':
      if (scripts.arabic && scripts.latin) return { status: 'pass', value, note: `${typed} in Arabic and English (${result.edits.length} edits)` };
      return { status: 'fail', value, note: `answered yes, but ${typed} has no ${scripts.arabic ? 'English' : 'Arabic'} letters` };
    case 'no':
      return { status: 'fail', value, note: `the keyboard did not work: ${typed}` };
    case 'skip':
      return { status: 'skip', value, note: 'skipped with Back' };
    default:
      return { status: 'skip', value, note: `nobody answered within ${INPUT_TIMEOUT_MS / 60_000} minutes` };
  }
}

const ALONE = 'run S10 alone (OK on its row)';

/** A fresh S10: its pointer check reads what this run's key tester saw. */
export function createS10(): Spike {
  let tested: KeyTestResult | null = null;

  const registration: Check = {
    id: 'registration',
    title: 'The app registers the remote keys it handles (Tizen)',
    run: (context: LabContext) => Promise.resolve(registrationResult(context.info.platform, context.keys)),
  };

  const keys: Check = {
    id: 'keys',
    title: 'Every remote key reaches the app: numbers, CH, colours, media, PRE-CH, Back',
    timeoutMs: INPUT_TIMEOUT_MS + 10_000,
    run: async (context: LabContext): Promise<CheckResult> => {
      tested = null;
      if (!context.interactive) return { status: 'skip', note: `${ALONE} and press every key` };
      tested = await context.testKeys({
        title: 'Press every key on the remote',
        prompt:
          'A box lights up with its key code when its key comes: the numbers, CH, the colours, the media keys, PRE-CH and Back. Keys with no action are listed with their codes. With a Magic Remote, also move the pointer, click and turn the wheel. Back twice in a row finishes.',
        intents: INTENTS,
        timeoutMs: INPUT_TIMEOUT_MS,
      });
      return keysResult(tested, INTENTS);
    },
  };

  const pointer: Check = {
    id: 'pointer',
    title: 'The Magic Remote pointer: shown, moved, clicked, the wheel',
    run: (): Promise<CheckResult> => {
      if (tested === null) return Promise.resolve({ status: 'skip', note: `${ALONE}: measured in the key tester` });
      return Promise.resolve(pointerResult(tested.pointer));
    },
  };

  const keyboard: Check = {
    id: 'keyboard',
    title: "The TV's keyboard types Arabic and English into the app's text field",
    timeoutMs: INPUT_TIMEOUT_MS + 10_000,
    run: async (context: LabContext): Promise<CheckResult> => {
      if (!context.interactive) return { status: 'skip', note: `${ALONE} and type with the TV's keyboard` };
      const result = await context.typeText({
        title: "Type with the TV's keyboard",
        prompt:
          'OK on the field opens the keyboard. Type زوما, switch the keyboard to English and type Zoma, then press its Done key. GREEN: both typed. RED: the keyboard did not work. BACK: skip.',
        timeoutMs: INPUT_TIMEOUT_MS,
      });
      return keyboardResult(result);
    },
  };

  return {
    id: 'S10',
    title: 'Input',
    question: 'Input: number, CH, colour and media keys, PRE-CH, Back, the Magic Remote pointer, and the TV keyboard in Arabic and English?',
    checks: [registration, keys, pointer, keyboard],
  };
}

export const S10: Spike = createS10();
