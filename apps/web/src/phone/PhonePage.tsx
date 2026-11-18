'use client';

/**
 * The phone page `/p` (RELAY steps 31b and 31d1, architecture.md §3.3 A, steps 2–4): a code from
 * the TV's QR link or typed, an Xtream login, an M3U link or an M3U file, sealed in this browser to
 * the TV's key (a file encrypted and uploaded first) and posted; then how far it got, until the
 * TV's status. The state is `state.ts`'s reducer; the requests are `flows.ts`'s and
 * `progress.ts`'s. Every text comes from `catalog.ts`.
 */
import { PAIR_EPG_MAX } from '@lablo/protocol';
import type { ReactNode, RefObject } from 'react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { PhoneApi } from './api';
import { createApi } from './api';
import type { MessageKey, Params } from './catalog';
import { fileSize, statusKey, t as translate } from './catalog';
import { groupCode, readFragment } from './code';
import { pickedFile, send, startQr, submitCode } from './flows';
import type { FieldKey, FieldProblem, SourceType } from './form';
import { FILE_MAX_BYTES, firstProblem } from './form';
import type { Lang } from './lang';
import { dirOf } from './lang';
import { pollProgress } from './progress';
import type { PageState, TextField, View } from './state';
import { initialState, reduce } from './state';
import './phone.css';

/** A code shaped like the TV's, for the format message. */
const EXAMPLE_CODE = '7K3M Q9XD';

export interface PhonePageProps {
  readonly initialLang: Lang;
  /** Tests may pass their own API; the page's own calls its origin. */
  readonly api?: PhoneApi;
}

export function PhonePage({ initialLang, api: givenApi }: PhonePageProps): ReactNode {
  const [state, dispatch] = useReducer(reduce, initialLang, initialState);
  const api = useMemo(() => givenApi ?? createApi(), [givenApi]);
  const deps = { api, dispatch };
  const { lang, view } = state;
  const t = (key: MessageKey, params?: Params): string => translate(lang, key, params);

  // The QR link's fragment: read once, then taken out of the address bar.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const target = readFragment(window.location.hash);
    if (window.location.hash !== '') window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    if (target === null) dispatch({ type: 'start' });
    else void startQr(target, { api, dispatch });
  }, [api]);

  // A QR link opened in this tab while the page shows (only the fragment changes, so the browser
  // doesn't load the page): load it again, to start from that code.
  useEffect(() => {
    const onHash = (): void => {
      if (window.location.hash !== '') window.location.reload();
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // The document's language follows the page's.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dirOf(lang);
    document.title = translate(lang, 'meta.title');
  }, [lang]);

  // The progress poll runs while the progress shows.
  const polling = view.kind === 'progress' ? view.code : null;
  useEffect(() => {
    if (polling === null) return;
    return pollProgress(polling, api, (result) => dispatch({ type: 'progressAnswer', code: polling, result }));
  }, [polling, api]);

  // A new view takes the focus to its heading; a refused send, to its first problem.
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(view.kind);
  useEffect(() => {
    if (shown.current === view.kind) return;
    shown.current = view.kind;
    heading.current?.focus();
  }, [view.kind]);
  useEffect(() => {
    if (!state.showProblems) return;
    const key = firstProblem(state.type, state.values, state.problems);
    if (key !== null) document.getElementById(key)?.focus();
    // Only when a send is refused (showProblems turns on), not as the fields change.
  }, [state.showProblems]);

  const toggleLang = (): void => {
    const next: Lang = lang === 'en' ? 'ar' : 'en';
    dispatch({ type: 'lang', lang: next });
    const url = new URL(window.location.href);
    url.searchParams.set('lang', next);
    window.history.replaceState(window.history.state, '', url.pathname + url.search);
  };

  return (
    <div className="phone" lang={lang} dir={dirOf(lang)} data-testid="phone" data-view={view.kind}>
      <header className="phone__header">
        <span className="phone__brand">{t('app.name')}</span>
        <button type="button" className="phone__link" lang={lang === 'en' ? 'ar' : 'en'} onClick={toggleLang} data-testid="lang">
          {t('lang.other')}
        </button>
      </header>
      <main className="phone__main">{body(state, view, t, deps, heading)}</main>
    </div>
  );
}

type T = (key: MessageKey, params?: Params) => string;
type Deps = { readonly api: PhoneApi; readonly dispatch: (event: Parameters<typeof reduce>[1]) => void };

function body(state: PageState, view: View, t: T, deps: Deps, heading: RefObject<HTMLHeadingElement | null>): ReactNode {
  switch (view.kind) {
    case 'starting':
      return null;
    case 'checking':
      return (
        <section className="phone__card">
          <h1 ref={heading} tabIndex={-1} className="phone__title">
            {t('code.title')}
          </h1>
          <p role="status" className="phone__muted">
            {t('code.checking')}
          </p>
        </section>
      );
    case 'code':
      return <CodeView state={state} view={view} t={t} deps={deps} heading={heading} />;
    case 'form':
      return <FormView state={state} view={view} t={t} deps={deps} heading={heading} />;
    case 'progress':
    case 'done':
      return <ProgressView view={view} t={t} deps={deps} heading={heading} />;
    case 'lost':
      return (
        <section className="phone__card">
          <h1 ref={heading} tabIndex={-1} className="phone__title">
            {t('lost.title')}
          </h1>
          <p>{t('lost.body')}</p>
          <button type="button" className="phone__button" onClick={() => deps.dispatch({ type: 'again', keep: true })}>
            {t('lost.again')}
          </button>
        </section>
      );
  }
}

interface ViewProps<V extends View['kind']> {
  readonly state: PageState;
  readonly view: Extract<View, { kind: V }>;
  readonly t: T;
  readonly deps: Deps;
  readonly heading: RefObject<HTMLHeadingElement | null>;
}

function CodeView({ state, view, t, deps, heading }: ViewProps<'code'>): ReactNode {
  const error = view.error;
  return (
    <section className="phone__card">
      <h1 ref={heading} tabIndex={-1} className="phone__title">
        {t('code.title')}
      </h1>
      <p className="phone__muted">{t('code.body')}</p>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submitCode(state, deps);
        }}
      >
        <label className="phone__label" htmlFor="code">
          {t('code.label')}
        </label>
        <input
          id="code"
          className="phone__input phone__input--code"
          dir="ltr"
          value={view.input}
          onChange={(event) => deps.dispatch({ type: 'codeInput', input: event.target.value })}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={16}
          aria-invalid={error === 'format' || error === 'unknown' ? true : undefined}
          aria-describedby={error === null ? undefined : 'code-error'}
          readOnly={view.busy}
        />
        {error === null ? null : (
          <p id="code-error" role="alert" className="phone__error" data-error={error}>
            {error === 'format'
              ? t('code.format', { example: EXAMPLE_CODE })
              : error === 'unknown'
                ? t('code.unknown')
                : error === 'ended'
                  ? t('code.ended')
                  : error === 'limited'
                    ? t('error.limited', { n: Math.ceil(view.retryAfterS / 60) })
                    : t('error.network')}
          </p>
        )}
        <button type="submit" className="phone__button" disabled={view.busy}>
          {view.busy ? t('code.checking') : t('code.continue')}
        </button>
      </form>
    </section>
  );
}

const PROBLEM_TEXT: Readonly<Record<FieldProblem, MessageKey>> = {
  required: 'field.required',
  url: 'field.url',
  spaces: 'field.spaces',
  long: 'field.long',
  noFile: 'field.noFile',
  empty: 'field.fileEmpty',
  large: 'field.fileLarge',
  unreadable: 'field.fileUnreadable',
};

const LINK_PARAMS: Params = { http: 'http://', https: 'https://' };

function FormView({ state, view, t, deps, heading }: ViewProps<'form'>): ReactNode {
  const { values, problems, showProblems } = state;
  const busy = view.busy;
  const maxSize = fileSize(state.lang, FILE_MAX_BYTES);
  const problemText = (key: FieldKey): string | null => {
    const problem = problems[key];
    return problem === undefined ? null : t(PROBLEM_TEXT[problem], { ...LINK_PARAMS, max: maxSize });
  };

  const field = (key: TextField, label: MessageKey, options: { hint?: string; type?: string; dir?: 'ltr' | 'auto'; maxLength: number; autoComplete?: string }): ReactNode => {
    const problem = problemText(key);
    const described = [options.hint === undefined ? null : `${key}-hint`, problem === null ? null : `${key}-problem`].filter((id) => id !== null).join(' ');
    return (
      <div className="phone__field" data-field={key}>
        <label className="phone__label" htmlFor={key}>
          {t(label)}
        </label>
        <input
          id={key}
          className="phone__input"
          type={options.type ?? 'text'}
          dir={options.dir ?? 'ltr'}
          value={values[key]}
          onChange={(event) => deps.dispatch({ type: 'field', key, value: event.target.value })}
          autoComplete={options.autoComplete ?? 'off'}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={options.maxLength}
          readOnly={busy}
          aria-invalid={problem === null ? undefined : true}
          aria-describedby={described === '' ? undefined : described}
        />
        {options.hint === undefined ? null : (
          <p id={`${key}-hint`} className="phone__hint">
            {options.hint}
          </p>
        )}
        {problem === null ? null : (
          <p id={`${key}-problem`} className="phone__problem">
            {problem}
          </p>
        )}
      </div>
    );
  };

  const typeOption = (type: SourceType, label: string): ReactNode => (
    <label className="phone__choice" data-checked={state.type === type ? 'true' : 'false'}>
      <input type="radio" name="source-type" value={type} checked={state.type === type} disabled={busy} onChange={() => deps.dispatch({ type: 'sourceType', sourceType: type })} />
      <span>{label}</span>
    </label>
  );

  const anyProblem = showProblems && Object.keys(problems).length > 0;
  return (
    <section className="phone__card">
      <h1 ref={heading} tabIndex={-1} className="phone__title">
        {t('form.title')}
      </h1>
      <p className="phone__muted" data-testid="form-code">
        {t('form.for', { code: groupCode(view.target.code) })}{' '}
        <button type="button" className="phone__link" disabled={busy} onClick={() => deps.dispatch({ type: 'again', keep: true })}>
          {t('form.otherCode')}
        </button>
      </p>
      <p className="phone__muted">{t('form.body')}</p>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void send(state, deps);
        }}
      >
        <fieldset className="phone__choices">
          <legend className="phone__label">{t('form.type')}</legend>
          {typeOption('xtream', t('type.xtream', { name: 'Xtream' }))}
          {typeOption('m3u', t('type.m3u', { format: 'M3U' }))}
          {typeOption('file', t('type.file', { format: 'M3U' }))}
        </fieldset>

        {state.type === 'xtream' ? (
          <>
            {field('server', 'field.server', { hint: t('field.serverHint', { scheme: 'http://' }), type: 'url', maxLength: 2048 })}
            {field('username', 'field.username', { dir: 'auto', maxLength: 256 })}
            <PasswordField state={state} busy={busy} t={t} deps={deps} problem={problemText('password')} />
          </>
        ) : state.type === 'm3u' ? (
          field('playlist', 'field.playlist', { hint: t('field.linkHint', LINK_PARAMS), type: 'url', maxLength: 2048 })
        ) : (
          <FileField state={state} busy={busy} t={t} deps={deps} problem={problemText('file')} maxSize={maxSize} />
        )}

        <div className="phone__group" data-testid="epg">
          {values.epg.map((value, index) => {
            const key: FieldKey = `epg${index}`;
            const problem = problemText(key);
            return (
              <div className="phone__field" data-field={key} key={index}>
                <label className="phone__label" htmlFor={key}>
                  {t('field.epg')}
                </label>
                <div className="phone__row">
                  <input
                    id={key}
                    className="phone__input"
                    type="url"
                    dir="ltr"
                    value={value}
                    onChange={(event) => deps.dispatch({ type: 'epg', index, value: event.target.value })}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={2048}
                    readOnly={busy}
                    aria-invalid={problem === null ? undefined : true}
                    aria-describedby={problem === null ? `${key}-hint` : `${key}-hint ${key}-problem`}
                  />
                  {values.epg.length > 1 ? (
                    <button type="button" className="phone__remove" disabled={busy} aria-label={t('field.epgRemove')} title={t('field.epgRemove')} onClick={() => deps.dispatch({ type: 'removeEpg', index })}>
                      <span aria-hidden="true">×</span>
                    </button>
                  ) : null}
                </div>
                <p id={`${key}-hint`} className="phone__hint">
                  {t('field.epgHint', { format: 'XMLTV' })}
                </p>
                {problem === null ? null : (
                  <p id={`${key}-problem`} className="phone__problem">
                    {problem}
                  </p>
                )}
              </div>
            );
          })}
          {values.epg.length < PAIR_EPG_MAX ? (
            <button type="button" className="phone__link" disabled={busy} onClick={() => deps.dispatch({ type: 'addEpg' })}>
              {t('field.epgAdd')}
            </button>
          ) : null}
        </div>

        {field('name', 'field.name', { hint: t('field.nameHint'), dir: 'auto', maxLength: 80 })}

        <p className="phone__private">{t('form.private')}</p>
        {anyProblem ? (
          <p role="alert" className="phone__error" data-error="problems">
            {t('form.check')}
          </p>
        ) : null}
        {view.error === null ? null : (
          <p role="alert" className="phone__error" data-error={view.error}>
            {view.error === 'limited' ? t('error.limited', { n: Math.ceil(view.retryAfterS / 60) }) : t('error.network')}
          </p>
        )}
        <button type="submit" className="phone__button" disabled={busy} data-testid="send">
          {busy ? t(state.type === 'file' ? 'form.sendingFile' : 'form.sending') : t('form.send')}
        </button>
      </form>
    </section>
  );
}

/**
 * The M3U file (step 31d1). The input stays in the page, focusable but unseen (a browser's own
 * "No file chosen" is in the browser's language, not the page's); its label is the button, and the
 * chosen file's name and size show under it. The input is emptied after each pick, so choosing
 * the same file again (after it couldn't be read) is a change too.
 */
function FileField({ state, busy, t, deps, problem, maxSize }: { state: PageState; busy: boolean; t: T; deps: Deps; problem: string | null; maxSize: string }): ReactNode {
  const file = state.file;
  const described = [file === null ? null : 'file-chosen', 'file-hint', problem === null ? null : 'file-problem'].filter((id) => id !== null).join(' ');
  return (
    <div className="phone__field phone__field--file" data-field="file">
      <span id="file-label" className="phone__label">
        {t('field.file')}
      </span>
      <input
        id="file"
        type="file"
        className="phone__file-input"
        disabled={busy}
        aria-labelledby="file-label file-button"
        aria-describedby={described}
        aria-invalid={problem === null ? undefined : true}
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          if (chosen !== undefined) deps.dispatch({ type: 'pickFile', file: pickedFile(chosen) });
          event.target.value = '';
        }}
      />
      <label id="file-button" htmlFor="file" className="phone__file-button">
        {file === null ? t('field.fileChoose') : t('field.fileChange')}
      </label>
      {file === null ? null : (
        <p id="file-chosen" className="phone__file-chosen" data-testid="file-chosen">
          {t('field.fileChosen', { name: file.name, size: fileSize(state.lang, file.size) })}
        </p>
      )}
      <p id="file-hint" className="phone__hint">
        {t('field.fileHint', { format: 'M3U', max: maxSize })}
      </p>
      {problem === null ? null : (
        <p id="file-problem" className="phone__problem">
          {problem}
        </p>
      )}
    </div>
  );
}

function PasswordField({ state, busy, t, deps, problem }: { state: PageState; busy: boolean; t: T; deps: Deps; problem: string | null }): ReactNode {
  const [shown, setShown] = useState(false);
  return (
    <div className="phone__field" data-field="password">
      <label className="phone__label" htmlFor="password">
        {t('field.password')}
      </label>
      <input
        id="password"
        className="phone__input"
        type={shown ? 'text' : 'password'}
        dir="ltr"
        value={state.values.password}
        onChange={(event) => deps.dispatch({ type: 'field', key: 'password', value: event.target.value })}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={256}
        readOnly={busy}
        aria-invalid={problem === null ? undefined : true}
        aria-describedby={problem === null ? undefined : 'password-problem'}
      />
      {problem === null ? null : (
        <p id="password-problem" className="phone__problem">
          {problem}
        </p>
      )}
      <label className="phone__check">
        <input type="checkbox" checked={shown} onChange={(event) => setShown(event.target.checked)} />
        <span>{t('field.showPassword')}</span>
      </label>
    </div>
  );
}

function ProgressView({ view, t, deps, heading }: Omit<ViewProps<'progress' | 'done'>, 'state'>): ReactNode {
  const received = view.kind === 'done' || view.state === 'received';
  const step = (label: MessageKey, mark: 'done' | 'current' | 'pending'): ReactNode => (
    <li className="phone__step" data-mark={mark}>
      {t(label)}
    </li>
  );
  if (view.kind === 'done') {
    const ok = view.status === 'ok';
    return (
      <section className="phone__card">
        <h1 ref={heading} tabIndex={-1} className="phone__title">
          {ok ? t('done.okTitle') : t('done.failedTitle')}
        </h1>
        <ol className="phone__steps">
          {step('progress.sent', 'done')}
          {step('progress.received', 'done')}
          {step('progress.result', 'done')}
        </ol>
        <p role="status" aria-live="polite" className={ok ? 'phone__result' : 'phone__result phone__result--failed'} data-testid="result" data-status={view.status}>
          {t(statusKey(view.status, view.sentType))}
        </p>
        {ok ? null : <p className="phone__muted">{t('done.newCode')}</p>}
        <button type="button" className="phone__button" onClick={() => deps.dispatch({ type: 'again', keep: !ok })}>
          {ok ? t('done.another') : t('done.fix')}
        </button>
      </section>
    );
  }
  return (
    <section className="phone__card">
      <h1 ref={heading} tabIndex={-1} className="phone__title">
        {t('progress.title')}
      </h1>
      <ol className="phone__steps">
        {step('progress.sent', 'done')}
        {step('progress.received', received ? 'done' : 'current')}
        {step('progress.result', received ? 'current' : 'pending')}
      </ol>
      <p role="status" aria-live="polite" className="phone__muted" data-testid="progress" data-state={view.state}>
        {view.state === 'sent' ? t('progress.sentWaiting') : t('progress.receivedChecking')}
      </p>
    </section>
  );
}
