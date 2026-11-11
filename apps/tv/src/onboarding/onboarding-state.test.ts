import type { Intent, KeyLike, RootBackPolicy, TextKey } from '@lablo/platform-api';
import type { EditableLike } from '@lablo/ui';
import { OK_CLICK_WINDOW_MS } from '@lablo/ui';
import { describe, expect, it, vi } from 'vitest';
import type { FieldId } from './form';
import type { FakeLoaderOptions, LoadResult, SourceLoader } from './loader';
import { LoadError, createFakeLoader } from './loader';
import type { OnboardingAnswer, OnboardingOptions } from './onboarding-state';
import { LANGUAGES, SOURCE_TYPES, createOnboarding, fieldDomId } from './onboarding-state';

const TEXT_KEYS: Record<number, TextKey> = { 13: 'done', 27: 'close', 38: 'up', 40: 'down' };

class FakeInput implements EditableLike {
  focused = false;
  focus(): void {
    this.focused = true;
  }
  blur(): void {
    this.focused = false;
  }
}

function setup(options: { rootBack?: RootBackPolicy; loader?: FakeLoaderOptions; answer?: OnboardingOptions['answer']; initial?: OnboardingOptions['initial'] } = {}) {
  const exitApp = vi.fn();
  const timers: Array<() => void> = [];
  let clock = 0;
  const inputs = new Map<string, FakeInput>();
  const ob = createOnboarding({
    platform: {
      rootBackPolicy: () => options.rootBack ?? 'exit-dialog',
      exitApp,
      textKey: (event: KeyLike) => TEXT_KEYS[event.keyCode] ?? null,
      onSoftKeyboard: () => () => undefined,
    },
    loader: createFakeLoader({ ...options.loader, setTimeout: (run) => timers.push(run) }),
    find: (id) => {
      let input = inputs.get(id);
      if (input === undefined) inputs.set(id, (input = new FakeInput()));
      return input;
    },
    now: () => clock,
    answer: options.answer,
    initial: options.initial,
  });
  const at = (): string => {
    const f = ob.nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  const press = (...keys: Intent[]) => keys.map((k) => ob.nav.handle(k));
  /** Runs the loader's pending steps, in order (each may queue the next). */
  const flush = async (): Promise<void> => {
    while (timers.length > 0) timers.shift()!();
    // Let the loader's promise settle.
    for (let i = 0; i < 3; i++) await Promise.resolve();
  };
  const later = (ms: number): void => {
    clock += ms;
  };
  /** Types into a field the way the remote does: OK, the text, then Enter. */
  const type = (id: FieldId, text: string): void => {
    press('OK');
    expect(ob.editor.editing.value).toBe(fieldDomId(id));
    ob.setValue(id, text);
    ob.editor.field(fieldDomId(id)).onEditInput();
    const event = { keyCode: 13, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    ob.editor.field(fieldDomId(id)).onEditKey(event);
    expect(event.preventDefault).toHaveBeenCalled();
  };
  return { ob, exitApp, at, press, flush, later, type, inputs };
}

/** Language → disclaimer → consent → source → the form, by keys. */
function toForm(s: ReturnType<typeof setup>, type: 'xtream' | 'm3u' = 'xtream'): void {
  s.press('OK', 'OK', 'OK');
  if (type === 'm3u') s.press('DOWN');
  s.press('OK');
}

describe('onboarding by remote (RELAY step 13a)', () => {
  it('walks from the language to the form, one screen per OK', () => {
    const s = setup();
    expect(s.at()).toBe('language · languages 0');
    expect(LANGUAGES).toEqual(['en', 'ar']);
    s.press('RIGHT');
    expect(s.at()).toBe('language · languages 1');
    s.press('OK');
    expect(s.ob.language.value).toBe('ar');
    expect(s.at()).toBe('disclaimer · actions 0');
    s.press('OK');
    expect(s.at()).toBe('consent · actions 0');
    s.press('RIGHT', 'OK');
    expect(s.ob.consent.value).toBe(false);
    expect(s.at()).toBe('source · types 0');
    expect(SOURCE_TYPES).toEqual(['xtream', 'm3u']);
    s.press('DOWN', 'OK');
    expect(s.ob.type.value).toBe('m3u');
    expect(s.at()).toBe('form · fields 0');
    expect(s.ob.nav.top.zone('fields')).toMatchObject({ count: 3 });
  });

  it('Allow is the first answer on the consent screen', () => {
    const s = setup();
    s.press('OK', 'OK', 'OK');
    expect(s.ob.consent.value).toBe(true);
  });

  it('Back goes one screen back, keeping each screen\'s focus and the answers', () => {
    const s = setup();
    s.press('RIGHT', 'OK', 'OK', 'RIGHT', 'OK', 'DOWN', 'OK');
    expect(s.at()).toBe('form · fields 0');
    s.ob.nav.back();
    expect(s.at()).toBe('source · types 1');
    s.ob.nav.back();
    expect(s.at()).toBe('consent · actions 1');
    s.ob.nav.back();
    s.ob.nav.back();
    expect(s.at()).toBe('language · languages 1');
    expect(s.ob.language.value).toBe('ar');
  });

  it('Back on the first screen opens the exit dialog (Tizen, the browser)', () => {
    const s = setup();
    expect(s.ob.nav.back()).toBe('exit-dialog');
    expect(s.at()).toBe('exit · actions 0');
    s.press('OK');
    expect(s.exitApp).not.toHaveBeenCalled();
    expect(s.at()).toBe('language · languages 0');
    s.ob.nav.back();
    s.press('RIGHT', 'OK');
    expect(s.exitApp).toHaveBeenCalledOnce();
    expect(s.ob.exitRequested.value).toBe(true);
  });

  it('Back on the first screen goes to the launcher on webOS', () => {
    const s = setup({ rootBack: 'platform-back' });
    expect(s.ob.nav.back()).toBe('exit');
    expect(s.exitApp).toHaveBeenCalledOnce();
  });

  it('preselects the TV\'s language until one is picked', () => {
    const s = setup();
    s.ob.preselect('ar');
    expect(s.at()).toBe('language · languages 1');
    s.ob.preselect('en');
    expect(s.at()).toBe('language · languages 0');
    s.press('OK');
    s.ob.nav.back();
    s.ob.preselect('ar');
    expect(s.at()).toBe('language · languages 0');
  });

  it('a picked language mirrors LEFT and RIGHT once the app sets the direction', () => {
    const s = setup();
    s.ob.nav.setDir('rtl');
    s.press('LEFT');
    expect(s.at()).toBe('language · languages 1');
  });
});

describe('the answers (RELAY step 13b)', () => {
  it('hands out each answer as it is given: the language, when the disclaimer was accepted, the consent', () => {
    const answers: OnboardingAnswer[] = [];
    const s = setup({ answer: (a) => answers.push(a) });
    s.press('RIGHT', 'OK');
    expect(answers).toEqual([{ language: 'ar' }]);
    s.later(1234);
    s.press('OK');
    expect(answers[1]).toEqual({ disclaimerAt: 1234 });
    s.press('RIGHT', 'OK');
    expect(answers[2]).toEqual({ consent: false });
    expect(s.at()).toBe('source · types 0');
    // Back and a new answer: handed out again (the profile keeps the last one).
    s.ob.nav.handle('BACK');
    s.press('LEFT', 'OK');
    expect(answers.slice(3)).toEqual([{ consent: true }]);
    expect(s.ob.consent.value).toBe(true);
  });

  it('starts in the language an earlier start saved, focused, and the TV language no longer moves the focus', () => {
    const s = setup({ initial: { language: 'ar' } });
    expect(s.ob.language.value).toBe('ar');
    expect(s.at()).toBe('language · languages 1');
    s.ob.preselect('en');
    expect(s.at()).toBe('language · languages 1');
    const none = setup({ initial: { language: null } });
    expect(none.ob.language.value).toBeNull();
    expect(none.at()).toBe('language · languages 0');
  });
});

describe('the source form', () => {
  it('OK on a field opens the editor on its input; done moves to the next field', () => {
    const s = setup();
    toForm(s);
    s.press('OK');
    expect(s.ob.editor.editing.value).toBe('onboarding-server');
    expect(s.inputs.get('onboarding-server')!.focused).toBe(true);
    s.later(OK_CLICK_WINDOW_MS);
    s.ob.editor.field('onboarding-server').onEditKey({ keyCode: 13, preventDefault: () => undefined, stopPropagation: () => undefined });
    expect(s.ob.editor.editing.value).toBeNull();
    expect(s.inputs.get('onboarding-server')!.focused).toBe(false);
    expect(s.at()).toBe('form · fields 1');
  });

  it('Add source refuses empty fields and focuses the first one', () => {
    const s = setup();
    toForm(s);
    s.press('DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN');
    expect(s.at()).toBe('form · actions 0');
    s.press('OK');
    expect(s.ob.problems.value).toEqual({ server: 'required', username: 'required', password: 'required' });
    expect(s.at()).toBe('form · fields 0');
    expect(s.ob.load.value.status).toBe('idle');
  });

  it('a changed field loses its problem; the others keep theirs', () => {
    const s = setup();
    toForm(s);
    s.press('DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'OK');
    s.ob.setValue('username', 'u');
    expect(s.ob.problems.value).toEqual({ server: 'required', password: 'required' });
    s.ob.setValue('name', 'x');
    expect(s.ob.problems.value).toEqual({ server: 'required', password: 'required' });
    expect(s.ob.values.value).toEqual({ username: 'u', name: 'x' });
  });

  it('typed by keys, a good login loads and lands on the done screen as the new root', async () => {
    const s = setup();
    toForm(s);
    s.type('server', 'provider.example:8080');
    s.type('username', 'user1');
    s.type('password', 'pw');
    s.press('DOWN', 'DOWN');
    expect(s.at()).toBe('form · actions 0');
    s.press('OK');
    expect(s.at()).toBe('loading · actions 0');
    expect(s.ob.draft.value).toMatchObject({ type: 'xtream', name: 'provider.example' });
    expect(s.ob.load.value).toEqual({ status: 'running', progress: { phase: 'checking', bytes: 0, total: null, items: 0 } });
    await s.flush();
    expect(s.ob.load.value).toEqual({ status: 'done', result: { live: 1240, movies: 380, series: 45 } });
    expect(s.at()).toBe('done · actions 0');
    expect(s.ob.root.value.id).toBe('done');
    // Back no longer goes into onboarding: the done screen is the root.
    expect(s.ob.nav.back()).toBe('exit-dialog');
    s.press('OK');
    expect(s.at()).toBe('done · actions 0');
    s.press('OK');
    expect(s.ob.finished.value).toBe(true);
  });

  it('reports progress while it loads', async () => {
    const s = setup();
    toForm(s, 'm3u');
    s.ob.setValue('playlist', 'p.example/l.m3u');
    s.press('DOWN', 'DOWN', 'DOWN', 'OK');
    expect(s.at()).toBe('loading · actions 0');
    const seen: string[] = [];
    const stop = s.ob.load.subscribe((state) => {
      if (state.status === 'running' && state.progress !== null) seen.push(`${state.progress.phase} ${state.progress.items}`);
    });
    await s.flush();
    stop();
    expect(seen).toEqual(['checking 0', 'download 416', 'download 833', 'download 1249', 'download 1665', 'saving 1665']);
  });

  it('a failed load offers Edit details and Try again', async () => {
    const s = setup({ loader: { fail: new LoadError('auth') } });
    toForm(s, 'm3u');
    s.ob.setValue('playlist', 'p.example/l.m3u');
    s.press('DOWN', 'DOWN', 'DOWN', 'OK');
    await s.flush();
    expect(s.ob.load.value).toEqual({ status: 'failed', code: 'auth', httpStatus: null });
    expect(s.at()).toBe('loading · actions 0');
    expect(s.ob.nav.top.zone('actions')).toMatchObject({ count: 2 });
    // Try again runs it again (and fails again with this loader).
    s.press('RIGHT', 'OK');
    expect(s.ob.load.value.status).toBe('running');
    expect(s.ob.nav.top.zone('actions')).toMatchObject({ count: 1 });
    await s.flush();
    expect(s.ob.load.value).toMatchObject({ status: 'failed', code: 'auth' });
    // Edit details goes back to the form, the values kept.
    s.press('OK');
    expect(s.at()).toBe('form · actions 0');
    expect(s.ob.values.value).toEqual({ playlist: 'p.example/l.m3u' });
  });

  it('keeps the HTTP status, and turns a non-LoadError into other', async () => {
    const s = setup({ loader: { fail: new LoadError('http', 404) } });
    toForm(s, 'm3u');
    s.ob.setValue('playlist', 'p.example/l.m3u');
    s.press('DOWN', 'DOWN', 'DOWN', 'OK');
    await s.flush();
    expect(s.ob.load.value).toEqual({ status: 'failed', code: 'http', httpStatus: 404 });

    const t = setup({ loader: { fail: new Error('boom') as LoadError } });
    toForm(t, 'm3u');
    t.ob.setValue('playlist', 'p.example/l.m3u');
    t.press('DOWN', 'DOWN', 'DOWN', 'OK');
    await t.flush();
    expect(t.ob.load.value).toEqual({ status: 'failed', code: 'other', httpStatus: null });
  });

  it.each(['cancel button', 'back'] as const)('the %s stops the load and goes back to the form', async (how) => {
    const s = setup();
    toForm(s, 'm3u');
    s.ob.setValue('playlist', 'p.example/l.m3u');
    s.press('DOWN', 'DOWN', 'DOWN', 'OK');
    expect(s.at()).toBe('loading · actions 0');
    if (how === 'back') s.press('BACK');
    else s.press('OK');
    expect(s.at()).toBe('form · actions 0');
    await s.flush();
    // The cancelled load never lands.
    expect(s.at()).toBe('form · actions 0');
    expect(s.ob.load.value.status).toBe('idle');
  });

  it('an older load\'s answer is dropped once a newer one runs', async () => {
    const s = setup({ loader: { fail: new LoadError('network') } });
    toForm(s, 'm3u');
    s.ob.setValue('playlist', 'p.example/l.m3u');
    s.press('DOWN', 'DOWN', 'DOWN', 'OK');
    await s.flush();
    s.press('RIGHT', 'OK');
    s.press('OK');
    // Cancelled by the Cancel button: the retry's failure doesn't show.
    await s.flush();
    expect(s.at()).toBe('form · actions 0');
    expect(s.ob.load.value.status).toBe('idle');
  });

  it('dispose stops a running load', async () => {
    const s = setup();
    toForm(s, 'm3u');
    s.ob.setValue('playlist', 'p.example/l.m3u');
    s.press('DOWN', 'DOWN', 'DOWN', 'OK');
    s.ob.dispose();
    await s.flush();
    expect(s.ob.load.value.status).toBe('idle');
    expect(s.at()).toBe('loading · actions 0');
  });
});

describe('loads that answer late', () => {
  /** A loader driven by hand: its answers come whenever the test says, cancelled or not (a reply already on its way). */
  function manual() {
    const loads: Array<{ resolve: (r: LoadResult) => void; reject: (e: unknown) => void; cancelled: number }> = [];
    const loader: SourceLoader = {
      start: () => {
        let resolve: (r: LoadResult) => void = () => undefined;
        let reject: (e: unknown) => void = () => undefined;
        const done = new Promise<LoadResult>((res, rej) => {
          resolve = res;
          reject = rej;
        });
        const entry = { resolve, reject, cancelled: 0 };
        loads.push(entry);
        return { done, cancel: () => (entry.cancelled += 1) };
      },
    };
    const ob = createOnboarding({
      platform: { rootBackPolicy: () => 'exit-dialog', exitApp: () => undefined, textKey: () => null, onSoftKeyboard: () => () => undefined },
      loader,
      find: () => ({ focus: () => undefined, blur: () => undefined }),
      now: () => 0,
    });
    const at = (): string => `${ob.nav.snapshot().screen} · ${ob.nav.snapshot().zone} ${ob.nav.snapshot().index}`;
    const settle = async (): Promise<void> => {
      for (let i = 0; i < 3; i++) await Promise.resolve();
    };
    // English, I understand, Allow, M3U link, a playlist, Add source.
    for (const k of ['OK', 'OK', 'OK', 'DOWN', 'OK'] as const) ob.nav.handle(k);
    ob.setValue('playlist', 'p.example/l.m3u');
    for (const k of ['DOWN', 'DOWN', 'DOWN', 'OK'] as const) ob.nav.handle(k);
    return { ob, loads, at, settle };
  }

  it('tells the loader to cancel, and drops what the cancelled load answers later', async () => {
    const m = manual();
    expect(m.at()).toBe('loading · actions 0');
    m.ob.nav.handle('OK');
    expect(m.loads[0]!.cancelled).toBe(1);
    expect(m.at()).toBe('form · actions 0');
    // Add source again: a second load runs; the first one's late answers change nothing.
    m.ob.nav.handle('OK');
    expect(m.loads).toHaveLength(2);
    m.loads[0]!.resolve({ live: 1, movies: 0, series: 0 });
    await m.settle();
    m.loads[0]!.reject(new LoadError('auth'));
    await m.settle();
    expect(m.ob.load.value).toEqual({ status: 'running', progress: null });
    expect(m.at()).toBe('loading · actions 0');
    m.loads[1]!.resolve({ live: 2, movies: 3, series: 4 });
    await m.settle();
    expect(m.ob.load.value).toEqual({ status: 'done', result: { live: 2, movies: 3, series: 4 } });
    expect(m.at()).toBe('done · actions 0');
  });

  it('drops a late failure of a cancelled load too', async () => {
    const m = manual();
    // BACK as the remote sends it (through the screen's onIntent).
    m.ob.nav.handle('BACK');
    expect(m.loads[0]!.cancelled).toBe(1);
    m.ob.nav.handle('OK');
    m.loads[0]!.reject(new LoadError('network'));
    await m.settle();
    expect(m.ob.load.value.status).toBe('running');
    expect(m.ob.nav.top.zone('actions')).toMatchObject({ count: 1 });
  });
});
