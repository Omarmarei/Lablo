/**
 * The requests behind the page's actions (RELAY step 31b). Each one tells the reducer what it is
 * about to do, makes its request, then hands over the answer: the reducer decides what shows.
 */
import type { SealedPayload } from '@lablo/crypto';
import { fromBase64Url, sealPairPayload, utf8 } from '@lablo/crypto';
import type { PhoneApi } from './api';
import type { QrTarget } from './code';
import { normalizeCode } from './code';
import { checkForm } from './form';
import type { PageEvent, PageState } from './state';

export interface FlowDeps {
  readonly api: PhoneApi;
  readonly dispatch: (event: PageEvent) => void;
  /** The browser's `sealPairPayload` (tests pass their own to see the plain payload). */
  readonly seal?: (plain: Uint8Array, tvPk: Uint8Array) => SealedPayload;
}

/** The typed code: the TV's key from the server, then the form. */
export async function submitCode(state: PageState, deps: FlowDeps): Promise<void> {
  const view = state.view;
  if (view.kind !== 'code' || view.busy) return;
  deps.dispatch({ type: 'codeSubmit' });
  const code = normalizeCode(view.input);
  if (code === null) return;
  deps.dispatch({ type: 'codeAnswer', code, result: await deps.api.tvKey(code) });
}

/** The QR link: its key is the TV's own, so only the code's progress is asked for. */
export async function startQr(target: QrTarget, deps: FlowDeps): Promise<void> {
  deps.dispatch({ type: 'qr', target });
  deps.dispatch({ type: 'progressAnswer', code: target.code, result: await deps.api.progress(target.code) });
}

/** The form: checked, sealed to the TV's key in this browser, and posted. */
export async function send(state: PageState, deps: FlowDeps): Promise<void> {
  const view = state.view;
  if (view.kind !== 'form' || view.busy) return;
  deps.dispatch({ type: 'send' });
  const { payload } = checkForm(state.type, state.values);
  if (payload === null) return;
  // The target's key passed `bytes32` (the fragment's check, or the server's answer's schema).
  const sealed = (deps.seal ?? sealPairPayload)(utf8(JSON.stringify(payload)), fromBase64Url(view.target.tvPk)!);
  deps.dispatch({ type: 'sendAnswer', code: view.target.code, result: await deps.api.send(view.target.code, sealed) });
}
