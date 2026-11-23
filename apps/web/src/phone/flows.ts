/**
 * The requests behind the page's actions (RELAY steps 31b and 31d1). Each one tells the reducer
 * what it is about to do, makes its request, then hands over the answer: the reducer decides what
 * shows.
 */
import type { SealedPayload } from '@lablo/crypto';
import { FILE_FRAME_BYTES, fileCipherLength, fileFrameCount, fromBase64Url, newFileKey, newFileNonceBase, sealFileFrame, sealPairPayload, toBase64Url, utf8 } from '@lablo/crypto';
import type { PairFile } from '@lablo/protocol';
import type { PhoneApi } from './api';
import type { QrTarget } from './code';
import { normalizeCode } from './code';
import type { PickedFile } from './form';
import { checkFor, withFile } from './form';
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

/** A file the browser's picker gave, read a slice at a time. */
export function pickedFile(file: Blob & { readonly name: string }): PickedFile {
  return { name: file.name, size: file.size, read: async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer()) };
}

/**
 * The file encrypted in this browser (architecture.md §3.3 A, step 4): read one 1 MiB frame at a
 * time, each frame sealed under a fresh key and nonce base, the frames joined into one `Blob`.
 * Null when the file can't be read (or has changed size since it was chosen).
 */
export async function encryptFile(file: PickedFile): Promise<{ readonly body: Blob; readonly fileKey: Uint8Array; readonly base: Uint8Array } | null> {
  const fileKey = newFileKey();
  const base = newFileNonceBase();
  const frames: Uint8Array[] = [];
  try {
    for (let i = 0; i < fileFrameCount(file.size); i += 1) {
      const start = i * FILE_FRAME_BYTES;
      const end = Math.min(start + FILE_FRAME_BYTES, file.size);
      const plain = await file.read(start, end);
      if (plain.length !== end - start) return null;
      frames.push(sealFileFrame(plain, fileKey, base, i));
    }
  } catch {
    return null;
  }
  return { body: new Blob(frames as BlobPart[]), fileKey, base };
}

/**
 * A file's way up, before its payload: the frames sealed, then the upload's URL for exactly their
 * length, then the PUT. The file's keys for the payload, or the event that ends the send.
 */
async function uploadFile(file: PickedFile, code: string, deps: FlowDeps): Promise<{ readonly ok: true; readonly file: PairFile } | { readonly ok: false; readonly event: PageEvent }> {
  const sealed = await encryptFile(file);
  if (sealed === null) return { ok: false, event: { type: 'fileUnreadable', code } };
  const target = await deps.api.uploadUrl(code, fileCipherLength(file.size));
  if (!target.ok) return { ok: false, event: { type: 'sendAnswer', code, result: target } };
  const put = await deps.api.upload(target.value.url, sealed.body);
  if (!put.ok) return { ok: false, event: { type: 'sendAnswer', code, result: put } };
  return { ok: true, file: { key: target.value.key, fileKey: toBase64Url(sealed.fileKey), base: toBase64Url(sealed.base), size: file.size } };
}

/** The form: checked for its purpose (a check's: the source alone), a file uploaded encrypted, the payload sealed to the TV's key in this browser, and posted. */
export async function send(state: PageState, deps: FlowDeps): Promise<void> {
  const view = state.view;
  if (view.kind !== 'form' || view.busy) return;
  deps.dispatch({ type: 'send' });
  const checked = checkFor(view.target.purpose, state.type, state.values, state.file);
  if (checked.payload === null) return;
  const code = view.target.code;
  let payload = checked.payload;
  if (payload.source.type === 'm3u-file') {
    const uploaded = await uploadFile(state.file!, code, deps);
    if (!uploaded.ok) {
      deps.dispatch(uploaded.event);
      return;
    }
    payload = withFile(payload, uploaded.file);
  }
  // The target's key passed `bytes32` (the fragment's check, or the server's answer's schema).
  const sealed = (deps.seal ?? sealPairPayload)(utf8(JSON.stringify(payload)), fromBase64Url(view.target.tvPk)!);
  deps.dispatch({ type: 'sendAnswer', code, result: await deps.api.send(code, sealed) });
}
