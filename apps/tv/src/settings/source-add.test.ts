import { signal } from '@preact/signals';
import { createNavigator } from '@lablo/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Refusal } from '../gate/gate-state';
import type { FormDraft } from '../onboarding/form';
import type { LoadHandle, LoadProgress, LoadResult, SourceLoader } from '../onboarding/loader';
import { LoadError } from '../onboarding/loader';
import type { AddFormOptions } from './source-add';
import { ADD_SCREEN, ADD_TYPES, addActions, addFieldId, createAddForm, fieldKind } from './source-add';

/**
 * "Add a source" on the TV (RELAY step 40f): the form's views, its checks (onboarding's), the load
 * through a held loader, and what each button does.
 */

interface Load {
  readonly draft: FormDraft | { readonly type: string };
  readonly progress: (progress: LoadProgress) => void;
  resolve(result: LoadResult): void;
  reject(error: unknown): void;
  cancelled: boolean;
}

/** A loader whose loads are settled by the test. */
function heldLoader() {
  const loads: Load[] = [];
  const loader: SourceLoader = {
    start(draft, progress): LoadHandle {
      let resolve!: (result: LoadResult) => void;
      let reject!: (error: unknown) => void;
      const done = new Promise<LoadResult>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const load: Load = { draft, progress, resolve, reject, cancelled: false };
      loads.push(load);
      return {
        done,
        cancel: () => {
          load.cancelled = true;
        },
      };
    },
  };
  return { loader, loads };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

function setup(extra: Partial<AddFormOptions> = {}) {
  const held = heldLoader();
  const nav = createNavigator({
    root: { id: 'settings', zones: [{ kind: 'list', id: 'items', axis: 'vertical', count: 2 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  const busy: boolean[] = [];
  const added = vi.fn();
  const form = createAddForm({
    nav,
    platform: { textKey: () => null, onSoftKeyboard: () => () => undefined },
    find: () => ({ focus: () => undefined, blur: () => undefined }),
    loader: held.loader,
    busy: (on) => busy.push(on),
    added,
    ...extra,
  });
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  const fill = (): void => {
    form.setValue('server', 'panel.test:8080');
    form.setValue('username', 'ann');
    form.setValue('password', 'pw');
  };
  return { nav, form, held, busy, added, at, fill };
}

const RESULT: LoadResult = { live: 5, movies: 2, series: 1 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the form’s parts', () => {
  it('has two kinds in order, their own fields, and onboarding’s field kinds', () => {
    expect(ADD_TYPES).toEqual(['xtream', 'm3u']);
    expect(fieldKind('server')).toBe('url');
    expect(fieldKind('password')).toBe('password');
    expect(fieldKind('username')).toBe('text');
    expect(fieldKind('name')).toBe('text');
    expect(fieldKind('epg')).toBe('url');
    expect(addFieldId('server')).toBe('source-add-server');
  });

  it('has each view’s buttons: the form adds or cancels, a failure edits or tries again, "Set a PIN" only when asked', () => {
    expect(addActions('form')).toEqual(['add', 'cancel']);
    expect(addActions('loading')).toEqual(['cancel']);
    expect(addActions('failed')).toEqual(['edit', 'retry']);
    expect(addActions('refused')).toEqual(['edit']);
    expect(addActions('done')).toEqual(['done']);
    expect(addActions('done', true)).toEqual(['pin', 'later']);
  });
});

describe('opening', () => {
  it('opens an empty Xtream form with the focus on its first field; the fields follow the kind', () => {
    const t = setup();
    t.form.open();
    expect(t.at()).toBe(`${ADD_SCREEN} · fields 0`);
    expect(t.form.type.value).toBe('xtream');
    expect(t.form.fields()).toEqual(['server', 'username', 'password', 'epg', 'name']);
    t.form.setType('m3u');
    expect(t.form.fields()).toEqual(['playlist', 'epg', 'name']);
    expect(t.form.shown.value).toBe(true);
  });

  it('opens again empty after it closed, and once only while it is open', () => {
    const t = setup();
    t.form.open();
    t.form.setValue('server', 'x');
    t.form.open();
    expect(t.form.values.value.server).toBe('x');
    t.nav.handle('BACK');
    expect(t.at()).toBe('settings · items 0');
    expect(t.form.shown.value).toBe(false);
    t.form.open();
    expect(t.form.values.value).toEqual({});
  });

  it('changes the kind on OK on its button, and keeps what was typed for the fields the kinds share', () => {
    const t = setup();
    t.form.open();
    t.form.setValue('epg', 'http://g.test/x.xml');
    t.nav.top.focus('type', 1);
    t.nav.handle('OK');
    expect(t.form.type.value).toBe('m3u');
    expect(t.at()).toBe(`${ADD_SCREEN} · type 1`);
    expect(t.form.values.value.epg).toBe('http://g.test/x.xml');
    t.nav.top.focus('type', 0);
    t.nav.handle('OK');
    expect(t.form.type.value).toBe('xtream');
  });
});

describe('the kind and the problems', () => {
  it('clears the problems when the kind changes, and keeps them when the same kind is picked again', () => {
    const t = setup();
    t.form.open();
    t.nav.top.focus('actions', 0);
    t.nav.handle('OK');
    expect(Object.keys(t.form.problems.value)).toEqual(['server', 'username', 'password']);
    t.form.setType('xtream');
    expect(Object.keys(t.form.problems.value)).toEqual(['server', 'username', 'password']);
    t.form.setType('m3u');
    expect(t.form.problems.value).toEqual({});
  });

  it('ends an edit under way when the kind changes', () => {
    const t = setup();
    t.form.open();
    t.nav.top.focus('fields', 0);
    t.nav.handle('OK');
    expect(t.form.editor.editing.value).toBe('source-add-server');
    t.form.setType('m3u');
    expect(t.form.editor.editing.value).toBeNull();
  });
});

describe('the checks', () => {
  it('refuses what onboarding refuses: the problems shown, the focus on the first, nothing loaded', () => {
    const t = setup();
    t.form.open();
    t.form.setValue('server', 'http://panel.test');
    t.nav.top.focus('actions', 0);
    t.nav.handle('OK');
    expect(t.form.problems.value).toEqual({ username: 'required', password: 'required' });
    expect(t.at()).toBe(`${ADD_SCREEN} · fields 1`);
    expect(t.held.loads).toEqual([]);
    expect(t.form.view.value).toBe('form');
    // A change clears its own problem.
    t.form.setValue('username', 'ann');
    expect(t.form.problems.value).toEqual({ password: 'required' });
  });

  it('refuses a playlist link with spaces', () => {
    const t = setup();
    t.form.open();
    t.form.setType('m3u');
    t.form.setValue('playlist', 'lists.test/a b.m3u');
    t.nav.top.focus('actions', 0);
    t.nav.handle('OK');
    expect(t.form.problems.value).toEqual({ playlist: 'spaces' });
    expect(t.at()).toBe(`${ADD_SCREEN} · fields 0`);
  });
});

describe('the load', () => {
  it('loads the checked draft, holds the refreshes meanwhile, shows its progress, then the counts, and tells the screens', async () => {
    const t = setup();
    t.form.open();
    t.fill();
    t.form.setValue('name', 'Home');
    t.nav.top.focus('actions', 0);
    t.nav.handle('OK');
    expect(t.form.view.value).toBe('loading');
    expect(t.busy).toEqual([true]);
    expect(t.held.loads).toHaveLength(1);
    expect(t.held.loads[0]!.draft).toMatchObject({ type: 'xtream', name: 'Home', account: { base: 'http://panel.test:8080', username: 'ann', password: 'pw' } });
    expect(t.form.name.value).toBe('Home');
    expect(t.at()).toBe(`${ADD_SCREEN} · actions 0`);
    t.held.loads[0]!.progress({ phase: 'download', bytes: 5, total: 10, items: 3 });
    expect(t.form.progress.value).toMatchObject({ phase: 'download', items: 3 });
    t.held.loads[0]!.resolve(RESULT);
    await flush();
    expect(t.form.view.value).toBe('done');
    expect(t.form.result.value).toEqual(RESULT);
    expect(t.busy).toEqual([true, false]);
    expect(t.added).toHaveBeenCalledTimes(1);
    expect(t.form.actions()).toEqual(['done']);
    t.nav.handle('OK');
    expect(t.at()).toBe('settings · items 0');
    expect(t.form.shown.value).toBe(false);
  });

  it('names the source by its host when no name was typed', () => {
    const t = setup();
    t.form.open();
    t.fill();
    t.nav.top.focus('actions', 0);
    t.nav.handle('OK');
    expect(t.form.name.value).toBe('panel.test');
  });

  it('says why a load failed and offers "Edit details" and "Try again"; trying again loads the same source', async () => {
    const t = setup();
    t.form.open();
    t.fill();
    t.nav.top.focus('actions', 0);
    t.nav.handle('OK');
    t.held.loads[0]!.reject(new LoadError('http', 404));
    await flush();
    expect(t.form.view.value).toBe('failed');
    expect(t.form.failure.value).toEqual({ code: 'http', status: 404 });
    expect(t.busy).toEqual([true, false]);
    expect(t.added).not.toHaveBeenCalled();
    expect(t.form.actions()).toEqual(['edit', 'retry']);
    expect(t.at()).toBe(`${ADD_SCREEN} · actions 0`);
    t.nav.handle('RIGHT');
    t.nav.handle('OK');
    expect(t.form.view.value).toBe('loading');
    expect(t.held.loads).toHaveLength(2);
    expect(t.held.loads[1]!.draft).toEqual(t.held.loads[0]!.draft);
    t.held.loads[1]!.reject(new Error('worker gone'));
    await flush();
    expect(t.form.failure.value).toEqual({ code: 'other', status: null });
    // "Edit details" returns to the form with what was typed.
    t.nav.handle('OK');
    expect(t.form.view.value).toBe('form');
    expect(t.form.values.value.username).toBe('ann');
    expect(t.at()).toBe(`${ADD_SCREEN} · fields 0`);
  });

  it('ends the load on "Cancel" and on Back, and returns to the form; an answer that comes late changes nothing', async () => {
    const t = setup();
    t.form.open();
    t.fill();
    t.nav.top.focus('actions', 0);
    t.nav.handle('OK');
    t.nav.handle('OK');
    expect(t.held.loads[0]!.cancelled).toBe(true);
    expect(t.form.view.value).toBe('form');
    expect(t.busy).toEqual([true, false]);
    t.held.loads[0]!.resolve(RESULT);
    await flush();
    expect(t.form.view.value).toBe('form');
    expect(t.added).not.toHaveBeenCalled();
    // Back from the loading view does the same.
    t.nav.top.focus('actions', 0);
    t.nav.handle('OK');
    expect(t.form.view.value).toBe('loading');
    t.nav.handle('BACK');
    expect(t.held.loads[1]!.cancelled).toBe(true);
    expect(t.form.view.value).toBe('form');
    expect(t.at()).toBe(`${ADD_SCREEN} · fields 0`);
  });

  it('drops the progress of a load that was cancelled, even when it reports late', () => {
    const t = setup();
    t.form.open();
    t.fill();
    t.nav.top.focus('actions', 0);
    t.nav.handle('OK');
    t.held.loads[0]!.progress({ phase: 'download', bytes: 1, total: 10, items: 1 });
    t.nav.handle('OK');
    expect(t.held.loads[0]!.cancelled).toBe(true);
    t.held.loads[0]!.progress({ phase: 'saving', bytes: 10, total: 10, items: 99 });
    expect(t.form.progress.value).toMatchObject({ phase: 'download', items: 1 });
  });

  it('closes on Back from the form, ending nothing; a closed form with a load running ends it', () => {
    const t = setup();
    t.form.open();
    t.fill();
    t.nav.top.focus('actions', 0);
    t.nav.handle('OK');
    t.form.dispose();
    expect(t.held.loads[0]!.cancelled).toBe(true);
    expect(t.busy).toEqual([true, false]);
  });

  it('Back from a failure returns to the form, Back from the done view closes', async () => {
    const t = setup();
    t.form.open();
    t.fill();
    t.nav.top.focus('actions', 0);
    t.nav.handle('OK');
    t.held.loads[0]!.reject(new LoadError('auth'));
    await flush();
    t.nav.handle('BACK');
    expect(t.form.view.value).toBe('form');
    t.nav.top.focus('actions', 0);
    t.nav.handle('OK');
    t.held.loads[1]!.resolve(RESULT);
    await flush();
    t.nav.handle('BACK');
    expect(t.at()).toBe('settings · items 0');
  });
});

describe('the config’s refusal', () => {
  it('shows the refusal, loads nothing and holds nothing; "Edit details" returns to the form', () => {
    const refusal: Refusal = { ruleId: 'block-new-sources', message: null } as unknown as Refusal;
    const t = setup({ refusal: signal<Refusal | null>(refusal) });
    t.form.open();
    t.fill();
    t.nav.top.focus('actions', 0);
    t.nav.handle('OK');
    expect(t.form.view.value).toBe('refused');
    expect(t.form.refusal.value).toBe(refusal);
    expect(t.held.loads).toEqual([]);
    expect(t.busy).toEqual([]);
    expect(t.form.actions()).toEqual(['edit']);
    t.nav.handle('OK');
    expect(t.form.view.value).toBe('form');
  });
});

describe('"Set a PIN"', () => {
  it('is offered when locked groups came in and the app gives the pad; the pad’s keeping closes the dialog, "Later" closes it at once', async () => {
    let kept: (() => void) | null = null;
    const t = setup({
      setPin: (done) => {
        kept = done;
      },
    });
    t.form.open();
    t.fill();
    t.nav.top.focus('actions', 0);
    t.nav.handle('OK');
    t.held.loads[0]!.resolve({ ...RESULT, askPin: true });
    await flush();
    expect(t.form.actions()).toEqual(['pin', 'later']);
    t.nav.handle('OK');
    expect(kept).not.toBeNull();
    expect(t.form.shown.value).toBe(true);
    kept!();
    expect(t.form.shown.value).toBe(false);
    expect(t.at()).toBe('settings · items 0');

    t.form.open();
    t.fill();
    t.nav.top.focus('actions', 0);
    t.nav.handle('OK');
    t.held.loads[1]!.resolve({ ...RESULT, askPin: true });
    await flush();
    t.nav.handle('RIGHT');
    t.nav.handle('OK');
    expect(t.form.shown.value).toBe(false);
  });

  it('is not offered without the pad, whatever the load says', async () => {
    const t = setup();
    t.form.open();
    t.fill();
    t.nav.top.focus('actions', 0);
    t.nav.handle('OK');
    t.held.loads[0]!.resolve({ ...RESULT, askPin: true });
    await flush();
    expect(t.form.actions()).toEqual(['done']);
  });
});
