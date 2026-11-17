/**
 * The phone page's state (RELAY step 31b) as a pure reducer: which view shows, what the person
 * typed, and what the server answered. The requests behind the actions are `flows.ts`'s; the
 * progress poll is `progress.ts`'s. The typed values outlive every view, so a code that ends while
 * the form is filled, or a source the TV refused, costs a new code, not the typing.
 */
import type { PairProgressResponse, PairStatus, PairTvKeyResponse } from '@lablo/protocol';
import { PAIR_EPG_MAX } from '@lablo/protocol';
import type { ApiResult } from './api';
import type { QrTarget } from './code';
import { normalizeCode } from './code';
import type { FieldKey, FormProblems, FormValues, SourceType } from './form';
import { checkForm, EMPTY_VALUES } from './form';
import type { Lang } from './lang';

/** The code and the TV's key the payload is sealed to (from the QR link, or the server for a typed code). */
export type Target = QrTarget;

/** Why the code view shows a message. */
export type CodeError = 'format' | 'unknown' | 'ended' | 'limited' | 'network';

/** Why sending failed with the form still showing. */
export type SendError = 'limited' | 'network';

export type View =
  /** Until the page has looked at its address (the server can't see the fragment). */
  | { readonly kind: 'starting' }
  | { readonly kind: 'code'; readonly input: string; readonly busy: boolean; readonly error: CodeError | null; readonly retryAfterS: number }
  /** The QR path, reading the code's progress before showing anything. */
  | { readonly kind: 'checking'; readonly target: Target }
  | { readonly kind: 'form'; readonly target: Target; readonly busy: boolean; readonly error: SendError | null; readonly retryAfterS: number }
  | { readonly kind: 'progress'; readonly code: string; readonly state: 'sent' | 'received' }
  | { readonly kind: 'done'; readonly code: string; readonly status: PairStatus }
  /** The code's row is gone (an hour after it was made): only the TV knows how it ended. */
  | { readonly kind: 'lost'; readonly code: string };

export interface PageState {
  readonly lang: Lang;
  readonly view: View;
  readonly type: SourceType;
  readonly values: FormValues;
  /** The form's problems, shown once a send was refused and kept current as the fields change. */
  readonly problems: FormProblems;
  readonly showProblems: boolean;
}

/** A form field holding one value (the guide links are `epg` events). */
export type TextField = Exclude<FieldKey, `epg${number}`>;

export type PageEvent =
  | { readonly type: 'lang'; readonly lang: Lang }
  /** The page found no QR link in its address: the code view. */
  | { readonly type: 'start' }
  | { readonly type: 'codeInput'; readonly input: string }
  | { readonly type: 'codeSubmit' }
  | { readonly type: 'codeAnswer'; readonly code: string; readonly result: ApiResult<PairTvKeyResponse> }
  | { readonly type: 'qr'; readonly target: Target }
  | { readonly type: 'progressAnswer'; readonly code: string; readonly result: ApiResult<PairProgressResponse> }
  | { readonly type: 'sourceType'; readonly sourceType: SourceType }
  | { readonly type: 'field'; readonly key: TextField; readonly value: string }
  | { readonly type: 'epg'; readonly index: number; readonly value: string }
  | { readonly type: 'addEpg' }
  | { readonly type: 'removeEpg'; readonly index: number }
  | { readonly type: 'send' }
  | { readonly type: 'sendAnswer'; readonly code: string; readonly result: ApiResult<PairProgressResponse> }
  /** Back to the code: `keep` the typed values (to fix and send again) or start empty. */
  | { readonly type: 'again'; readonly keep: boolean };

export const CODE_VIEW: Extract<View, { kind: 'code' }> = { kind: 'code', input: '', busy: false, error: null, retryAfterS: 0 };

export function initialState(lang: Lang): PageState {
  return { lang, view: { kind: 'starting' }, type: 'xtream', values: EMPTY_VALUES, problems: {}, showProblems: false };
}

/** The view an answer about the code's progress leads to; null keeps the current one. */
function progressView(code: string, progress: PairProgressResponse): View | null {
  switch (progress.state) {
    case 'sent':
    case 'received':
      return { kind: 'progress', code, state: progress.state };
    case 'done':
      return { kind: 'done', code, status: progress.status };
    case 'open':
      return null;
  }
}

/** A field changed: the problems follow while they show. */
function withValues(state: PageState, values: FormValues, type = state.type): PageState {
  return { ...state, type, values, problems: state.showProblems ? checkForm(type, values).problems : {} };
}

export function reduce(state: PageState, event: PageEvent): PageState {
  const view = state.view;
  switch (event.type) {
    case 'lang':
      return { ...state, lang: event.lang };

    case 'start':
      return view.kind === 'starting' ? { ...state, view: CODE_VIEW } : state;

    case 'codeInput':
      return view.kind === 'code' && !view.busy ? { ...state, view: { ...view, input: event.input, error: null } } : state;

    case 'codeSubmit': {
      if (view.kind !== 'code' || view.busy) return state;
      const code = normalizeCode(view.input);
      return { ...state, view: code === null ? { ...view, error: 'format' } : { ...view, busy: true, error: null } };
    }

    case 'codeAnswer': {
      if (view.kind !== 'code' || !view.busy || normalizeCode(view.input) !== event.code) return state;
      const result = event.result;
      if (result.ok) return { ...state, view: { kind: 'form', target: { code: event.code, tvPk: result.value.tvPk }, busy: false, error: null, retryAfterS: 0 } };
      if (result.error === 'gone') return { ...state, view: { ...view, busy: false, error: 'unknown' } };
      if (result.error === 'limited') return { ...state, view: { ...view, busy: false, error: 'limited', retryAfterS: result.retryAfterS } };
      return { ...state, view: { ...view, busy: false, error: 'network' } };
    }

    case 'qr':
      return view.kind === 'starting' ? { ...state, view: { kind: 'checking', target: event.target } } : state;

    case 'progressAnswer': {
      const result = event.result;
      if (view.kind === 'checking' && view.target.code === event.code) {
        // The code's progress decides; without an answer the form shows, and sending will tell.
        if (result.ok) return { ...state, view: progressView(event.code, result.value) ?? { kind: 'form', target: view.target, busy: false, error: null, retryAfterS: 0 } };
        if (result.error === 'gone') return { ...state, view: { ...CODE_VIEW, error: 'ended' } };
        return { ...state, view: { kind: 'form', target: view.target, busy: false, error: null, retryAfterS: 0 } };
      }
      if (view.kind === 'progress' && view.code === event.code) {
        if (result.ok) return { ...state, view: progressView(event.code, result.value) ?? view };
        if (result.error === 'gone') return { ...state, view: { kind: 'lost', code: event.code } };
      }
      return state;
    }

    case 'sourceType':
      return view.kind === 'form' && !view.busy ? withValues(state, state.values, event.sourceType) : state;

    case 'field':
      return view.kind === 'form' && !view.busy ? withValues(state, { ...state.values, [event.key]: event.value }) : state;

    case 'epg': {
      if (view.kind !== 'form' || view.busy || event.index < 0 || event.index >= state.values.epg.length) return state;
      const epg = state.values.epg.slice();
      epg[event.index] = event.value;
      return withValues(state, { ...state.values, epg });
    }

    case 'addEpg':
      if (view.kind !== 'form' || view.busy || state.values.epg.length >= PAIR_EPG_MAX) return state;
      return withValues(state, { ...state.values, epg: [...state.values.epg, ''] });

    case 'removeEpg': {
      if (view.kind !== 'form' || view.busy || event.index < 0 || event.index >= state.values.epg.length) return state;
      const epg = state.values.epg.filter((_, i) => i !== event.index);
      return withValues(state, { ...state.values, epg: epg.length === 0 ? [''] : epg });
    }

    case 'send': {
      if (view.kind !== 'form' || view.busy) return state;
      const checked = checkForm(state.type, state.values);
      if (checked.payload === null) return { ...state, problems: checked.problems, showProblems: true, view: { ...view, error: null } };
      return { ...state, problems: {}, showProblems: false, view: { ...view, busy: true, error: null } };
    }

    case 'sendAnswer': {
      if (view.kind !== 'form' || !view.busy || view.target.code !== event.code) return state;
      const result = event.result;
      // Sent now, or already sent (409): either way the code's progress is what to show.
      if (result.ok || result.error === 'conflict') {
        return { ...state, view: (result.ok ? progressView(event.code, result.value) : null) ?? { kind: 'progress', code: event.code, state: 'sent' } };
      }
      if (result.error === 'gone') return { ...state, view: { ...CODE_VIEW, error: 'ended' } };
      if (result.error === 'limited') return { ...state, view: { ...view, busy: false, error: 'limited', retryAfterS: result.retryAfterS } };
      return { ...state, view: { ...view, busy: false, error: 'network' } };
    }

    case 'again':
      if (view.kind === 'starting' || view.kind === 'checking' || (view.kind === 'code' && view.busy) || (view.kind === 'form' && view.busy)) return state;
      return {
        ...state,
        view: CODE_VIEW,
        problems: {},
        showProblems: false,
        ...(event.keep ? {} : { type: 'xtream' as const, values: EMPTY_VALUES }),
      };
  }
}
