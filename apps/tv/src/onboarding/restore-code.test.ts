import type { VNode } from 'preact';
import { stripIsolates } from '@lablo/core';
import type { LoadedProfile } from '@lablo/data';
import type { BackupCodeRequest, BackupRestoreResult, CancelToken } from '@lablo/data/client';
import { CancelError } from '@lablo/data/client';
import type { KeyLike, TextKey } from '@lablo/platform-api';
import type { EditableLike, FieldEditing, ItemState, ZoneView } from '@lablo/ui';
import { Button, ProgressBar, Spinner, TextField } from '@lablo/ui';
import { describe, expect, it, vi } from 'vitest';
import { LOOKUP_LIMIT_MS } from '../backup/backup-start';
import { appI18n } from '../i18n';
import type { Pairing } from '../pairing/pair-state';
import { SOURCE_TYPES, createOnboarding, sourceRows } from './onboarding-state';
import type { RestoreCodeContentProps } from './RestoreCodePage';
import { RestoreCodeContent, codeProblemText, restoreNoticeText } from './RestoreCodePage';
import type { RestoreCodeHost, RestoreNotice } from './restore-code';
import { CODE_FIELD, CODE_LIMIT_MS, RESTORE_CODE_SCREEN, codeProblem, codeTyped, restoreNotice } from './restore-code';

/**
 * "Restore with a backup code" at the first start (RELAY step 32d3c): the source screen's row,
 * the screen's state over a fake data engine, and the screen as drawn (its components called as
 * functions). e2e/backup-code.spec.ts restores a real backup through it.
 */

/** A code the TV could have made (crypto's backup-code tests), and as a person might type it. */
const CODE = '014D2PF2DBSQQZXQ5TK1V58CGG';
const TYPED = '014d 2pf2-dbsq qzxq 5tk1 v58c gg';
const SHOWN = '014D 2PF2 DBSQ QZXQ 5TK1 V58C GG';

const TEXT_KEYS: Record<number, TextKey> = { 13: 'done', 27: 'close', 38: 'up', 40: 'down' };
const WITH_SOURCE = { doc: { v: 8, sources: [{ id: 's1', type: 'm3u' }] } } as unknown as LoadedProfile;
const SOURCELESS = { doc: { v: 8, sources: [] } } as unknown as LoadedProfile;
const BUILD = { platform: 'browser', appId: 'com.lablo.test', base: 'http://127.0.0.1:3100' };

class FakeInput implements EditableLike {
  focused = false;
  focus(): void {
    this.focused = true;
  }
  blur(): void {
    this.focused = false;
  }
}

interface Call {
  readonly request: BackupCodeRequest;
  readonly onProgress?: (fraction: number) => void;
  readonly cancel?: CancelToken;
  resolve(result: BackupRestoreResult): void;
  reject(error: unknown): void;
}

interface Timer {
  readonly run: () => void;
  readonly ms: number;
  cleared: boolean;
}

function setup(options: { pairing?: boolean; restore?: boolean; slotHeld?: boolean } = {}) {
  const calls: Call[] = [];
  const restart = vi.fn();
  const warn = vi.fn();
  const timers: Timer[] = [];
  const slots: Array<() => void> = [];
  const state = { profile: null as LoadedProfile | null, profileFails: false, profileReads: 0, slotHeld: options.slotHeld === true, slotAsks: 0, rejectOnCancel: true };
  const inputs = new Map<string, FakeInput>();
  const host: RestoreCodeHost = {
    engine: {
      restoreBackupCode: (request, opts) =>
        new Promise<BackupRestoreResult>((resolve, reject) => {
          calls.push({ request, onProgress: opts.onProgress, cancel: opts.cancel, resolve, reject });
          // As the data engine's client: a cancel rejects at once (the worker is ended).
          opts.cancel?.onCancel(() => {
            if (state.rejectOnCancel) reject(new CancelError());
          });
        }),
      profile: () => {
        state.profileReads += 1;
        return state.profileFails ? Promise.reject(new Error('the database is gone')) : Promise.resolve(state.profile);
      },
    },
    build: BUILD,
    slotFree: () => {
      state.slotAsks += 1;
      return state.slotHeld ? new Promise<void>((resolve) => slots.push(resolve)) : Promise.resolve();
    },
    restart,
    limitMs: 1234,
    timers: {
      set: (run, ms) => {
        const timer: Timer = { run, ms, cleared: false };
        timers.push(timer);
        return timer;
      },
      clear: (handle) => {
        (handle as Timer).cleared = true;
      },
    },
    warn,
  };
  const pairing = { open: vi.fn(), dispose: vi.fn() } as unknown as Pairing;
  const ob = createOnboarding({
    platform: {
      rootBackPolicy: () => 'exit-dialog',
      exitApp: vi.fn(),
      textKey: (event: KeyLike) => TEXT_KEYS[event.keyCode] ?? null,
      onSoftKeyboard: () => () => undefined,
    },
    loader: {
      start: () => {
        throw new Error('no source loads in these tests');
      },
    },
    find: (id) => {
      let input = inputs.get(id);
      if (input === undefined) inputs.set(id, (input = new FakeInput()));
      return input;
    },
    now: () => 0,
    ...(options.pairing === true ? { pairing: () => pairing } : {}),
    ...(options.restore === false ? {} : { restoreCode: host }),
  });
  const at = (): string => {
    const f = ob.nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  const press = (...keys: Array<'OK' | 'BACK' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'>) => keys.map((k) => ob.nav.handle(k));
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  const restore = () => ob.restoreCode!;
  /** Language, disclaimer, "Not now", then the source screen's last row: the code's screen on its field. */
  const toScreen = (): void => {
    press('OK', 'OK', 'RIGHT', 'OK');
    const rows = (ob.nav.top.zone('types') as { count: number }).count;
    for (let i = 1; i < rows; i++) press('DOWN');
    press('OK');
  };
  /** Types into the field the way the remote does: OK, the text, then Enter (the focus moves to "Restore"). */
  const type = (text: string): void => {
    press('OK');
    expect(ob.editor.editing.value).toBe(CODE_FIELD);
    restore().setText(text);
    ob.editor.field(CODE_FIELD).onEditInput();
    ob.editor.field(CODE_FIELD).onEditKey({ keyCode: 13, preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(ob.editor.editing.value).toBeNull();
  };
  /** On the code's screen, the code typed and "Restore" pressed, the slot free: the worker asked once. */
  const restoring = async (): Promise<Call> => {
    toScreen();
    type(TYPED);
    press('OK');
    await flush();
    expect(calls).toHaveLength(1);
    return calls[0]!;
  };
  const fieldCount = (): number => (ob.nav.top.zone('field') as { count: number }).count;
  return { ob, host, calls, restart, warn, timers, slots, state, inputs, pairing, at, press, flush, restore, toScreen, type, restoring, fieldCount };
}

describe('the code as typed', () => {
  it('is drawn in upper case, in groups of four, whatever spaces and dashes were typed', () => {
    expect(codeTyped(TYPED)).toBe(SHOWN);
    expect(codeTyped(CODE)).toBe(SHOWN);
    expect(codeTyped('')).toBe('');
    expect(codeTyped('abcd')).toBe('ABCD');
    expect(codeTyped('abcde')).toBe('ABCD E');
    expect(codeTyped(' a-b\tc\nd e ')).toBe('ABCD E');
    // Drawn as typed: nothing is read as another character here (the check does that).
    expect(codeTyped('oil?')).toBe('OIL?');
  });

  it("says why the text can't be a code: nothing, a wrong length, or a character no code has", () => {
    expect(codeProblem(TYPED)).toBeNull();
    expect(codeProblem(SHOWN)).toBeNull();
    expect(codeProblem('o14d2pf2dbsqqzxq5tklv58cgg')).toBeNull();
    expect(codeProblem('')).toBe('required');
    expect(codeProblem(' - \t\n')).toBe('required');
    expect(codeProblem(CODE.slice(1))).toBe('length');
    expect(codeProblem(CODE + '0')).toBe('length');
    expect(codeProblem('1')).toBe('length');
    expect(codeProblem('U' + CODE.slice(1))).toBe('invalid');
    expect(codeProblem('8' + CODE.slice(1))).toBe('invalid');
    expect(codeProblem(CODE.slice(0, 25) + '?')).toBe('invalid');
  });

  it("names each answer that isn't a restore", () => {
    expect(restoreNotice({ state: 'none' })).toBe('none');
    expect(restoreNotice({ state: 'newer' })).toBe('newer');
    expect(restoreNotice({ state: 'unreadable' })).toBe('unreadable');
    expect(restoreNotice({ state: 'failed', failure: 'network' })).toBe('network');
    expect(restoreNotice({ state: 'failed', failure: 'timeout' })).toBe('network');
    expect(restoreNotice({ state: 'failed', failure: 'rate' })).toBe('rate');
    expect(restoreNotice({ state: 'failed', failure: 'status' })).toBe('status');
    expect(restoreNotice({ state: 'restored', language: 'ar', sources: 1 })).toBeNull();
    expect(restoreNotice({ state: 'kept' })).toBeNull();
  });
});

describe("the source screen's row", () => {
  it('lists the types, then the phone, then the code', () => {
    expect(sourceRows(false, false)).toEqual(['xtream', 'm3u']);
    expect(sourceRows(true, false)).toEqual(['xtream', 'm3u', 'phone']);
    expect(sourceRows(false, true)).toEqual(['xtream', 'm3u', 'restore']);
    expect(sourceRows(true, true)).toEqual(['xtream', 'm3u', 'phone', 'restore']);
    // A fresh list each time: SOURCE_TYPES itself is never added to.
    expect(SOURCE_TYPES).toEqual(['xtream', 'm3u']);
  });

  it("is the last row, after the phone's, and opens the code's screen on its field", () => {
    const s = setup({ pairing: true });
    s.press('OK', 'OK', 'RIGHT', 'OK');
    expect(s.at()).toBe('source · types 0');
    expect((s.ob.nav.top.zone('types') as { count: number }).count).toBe(4);
    s.press('DOWN', 'DOWN', 'OK');
    expect(s.pairing.open).toHaveBeenCalledTimes(1);
    s.press('DOWN', 'OK');
    expect(s.pairing.open).toHaveBeenCalledTimes(1);
    expect(s.at()).toBe(`${RESTORE_CODE_SCREEN} · field 0`);
    expect(s.fieldCount()).toBe(1);
    expect(s.ob.nav.top.zone('actions')).toMatchObject({ count: 1 });
    expect(s.restore().phase.value).toBe('typing');
    // Back: the source screen again, on the row.
    s.press('BACK');
    expect(s.at()).toBe('source · types 3');
  });

  it('is the third row without a way to pair', () => {
    const s = setup();
    s.press('OK', 'OK', 'RIGHT', 'OK');
    expect((s.ob.nav.top.zone('types') as { count: number }).count).toBe(3);
    s.press('DOWN', 'DOWN', 'OK');
    expect(s.at()).toBe(`${RESTORE_CODE_SCREEN} · field 0`);
  });

  it("isn't there without the host, nor the screen", () => {
    const s = setup({ restore: false, pairing: true });
    expect(s.ob.restoreCode).toBeNull();
    s.press('OK', 'OK', 'RIGHT', 'OK');
    expect((s.ob.nav.top.zone('types') as { count: number }).count).toBe(3);
    s.press('DOWN', 'DOWN', 'OK');
    expect(s.pairing.open).toHaveBeenCalledTimes(1);
    expect(s.at()).toBe('source · types 2');
  });
});

describe('typing the code', () => {
  it('opens the editor on OK, draws the text as a code, and keeps it across Back', () => {
    const s = setup();
    s.toScreen();
    s.type(TYPED);
    expect(s.restore().text.value).toBe(SHOWN);
    expect(s.at()).toBe(`${RESTORE_CODE_SCREEN} · actions 0`);
    s.press('UP');
    expect(s.at()).toBe(`${RESTORE_CODE_SCREEN} · field 0`);
    s.press('DOWN');
    expect(s.at()).toBe(`${RESTORE_CODE_SCREEN} · actions 0`);
    s.press('BACK');
    expect(s.at()).toBe('source · types 2');
    s.press('OK');
    expect(s.restore().text.value).toBe(SHOWN);
  });

  it.each([
    ['', 'required'],
    [CODE.slice(2), 'length'],
    ['U' + CODE.slice(1), 'invalid'],
  ] as const)("refuses %j (%s) under the field, the focus back on it, no worker or wait", async (text, problem) => {
    const s = setup();
    s.toScreen();
    if (text !== '') s.type(text);
    else s.press('DOWN');
    expect(s.at()).toBe(`${RESTORE_CODE_SCREEN} · actions 0`);
    s.press('OK');
    await s.flush();
    expect(s.restore().problem.value).toBe(problem);
    expect(s.at()).toBe(`${RESTORE_CODE_SCREEN} · field 0`);
    expect(s.restore().phase.value).toBe('typing');
    expect(s.state.slotAsks).toBe(0);
    expect(s.calls).toHaveLength(0);
  });

  it('clears the problem and the last answer when the text changes, and on opening again', async () => {
    const s = setup();
    s.toScreen();
    s.press('DOWN', 'OK');
    expect(s.restore().problem.value).toBe('required');
    s.restore().setText('a');
    expect(s.restore().problem.value).toBeNull();
    s.restore().setText(TYPED);
    s.press('DOWN', 'OK');
    await s.flush();
    s.calls[0]!.resolve({ state: 'none' });
    await s.flush();
    expect(s.restore().notice.value).toBe('none');
    s.restore().setText(TYPED + 'x');
    expect(s.restore().notice.value).toBeNull();
    s.press('DOWN', 'OK');
    expect(s.restore().problem.value).toBe('length');
    s.press('BACK');
    s.press('OK');
    expect(s.restore().problem.value).toBeNull();
    // An answer goes too.
    s.restore().setText(TYPED);
    s.press('DOWN', 'OK');
    await s.flush();
    s.calls[1]!.resolve({ state: 'failed', failure: 'status' });
    await s.flush();
    expect(s.restore().notice.value).toBe('status');
    s.press('BACK');
    s.press('OK');
    expect(s.restore().notice.value).toBeNull();
    expect(s.restore().text.value).toBe(SHOWN);
  });
});

describe('restoring', () => {
  it("waits for the refresh slot, then asks the worker with the build's half and the code, time-limited", async () => {
    const s = setup({ slotHeld: true });
    s.toScreen();
    s.type(TYPED);
    s.press('OK');
    expect(s.restore().phase.value).toBe('restoring');
    expect(s.restore().problem.value).toBeNull();
    expect(s.fieldCount()).toBe(0);
    expect(s.at()).toBe(`${RESTORE_CODE_SCREEN} · actions 0`);
    await s.flush();
    expect(s.state.slotAsks).toBe(1);
    expect(s.calls).toHaveLength(0);
    expect(s.timers).toHaveLength(0);
    s.slots[0]!();
    await s.flush();
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]!.request).toEqual({ ...BUILD, code: SHOWN });
    expect(s.timers).toHaveLength(1);
    expect(s.timers[0]!.ms).toBe(1234);
  });

  it("uses the look-up's time limit by default", async () => {
    const s = setup();
    const { engine, build, slotFree, restart, timers, warn } = s.host;
    const ob = createOnboarding({
      platform: { rootBackPolicy: () => 'exit-dialog', exitApp: vi.fn(), textKey: () => null, onSoftKeyboard: () => () => undefined },
      loader: { start: () => ({ done: new Promise(() => undefined), cancel: () => undefined }) },
      find: () => new FakeInput(),
      restoreCode: { engine, build, slotFree, restart, timers, warn },
    });
    ob.restoreCode!.open();
    ob.restoreCode!.setText(CODE);
    ob.nav.handle('DOWN');
    ob.nav.handle('OK');
    await s.flush();
    expect(s.timers.map((t) => t.ms)).toEqual([CODE_LIMIT_MS]);
    expect(CODE_LIMIT_MS).toBe(LOOKUP_LIMIT_MS);
  });

  it("shows scrypt's progress", async () => {
    const s = setup();
    const call = await s.restoring();
    expect(s.restore().progress.value).toBeNull();
    call.onProgress!(0.25);
    expect(s.restore().progress.value).toBe(0.25);
    call.onProgress!(1);
    expect(s.restore().progress.value).toBe(1);
  });

  it('starts the app again as after a restore when the backup is restored ("Welcome back")', async () => {
    const s = setup();
    const call = await s.restoring();
    call.resolve({ state: 'restored', language: 'ar', sources: 2 });
    await s.flush();
    expect(s.restart).toHaveBeenCalledTimes(1);
    expect(s.restart).toHaveBeenCalledWith(true);
    expect(s.restore().phase.value).toBe('restarting');
    expect(s.timers[0]!.cleared).toBe(true);
    // Nothing more: keys do nothing while the app starts again.
    s.press('OK');
    s.press('BACK');
    expect(s.at()).toBe(`${RESTORE_CODE_SCREEN} · actions 0`);
    expect(s.restore().phase.value).toBe('restarting');
    await s.flush();
    expect(s.calls).toHaveLength(1);
    expect(s.restart).toHaveBeenCalledTimes(1);
    expect(s.state.profileReads).toBe(0);
  });

  it('starts the app plainly when a source got there meanwhile (kept)', async () => {
    const s = setup();
    const call = await s.restoring();
    call.resolve({ state: 'kept' });
    await s.flush();
    expect(s.restart).toHaveBeenCalledTimes(1);
    expect(s.restart).toHaveBeenCalledWith(false);
    expect(s.restore().phase.value).toBe('restarting');
  });

  it('says no backup was found, with the field back and focused, the code kept', async () => {
    const s = setup();
    const call = await s.restoring();
    call.onProgress!(0.5);
    call.resolve({ state: 'none' });
    await s.flush();
    expect(s.restore().notice.value).toBe('none');
    expect(s.restore().phase.value).toBe('typing');
    expect(s.restore().text.value).toBe(SHOWN);
    expect(s.fieldCount()).toBe(1);
    expect(s.at()).toBe(`${RESTORE_CODE_SCREEN} · field 0`);
    expect(s.timers[0]!.cleared).toBe(true);
    expect(s.restart).not.toHaveBeenCalled();
    expect(s.state.profileReads).toBe(0);
  });

  it.each([
    [{ state: 'newer' }, 'newer'],
    [{ state: 'unreadable' }, 'unreadable'],
    [{ state: 'failed', failure: 'network' }, 'network'],
    [{ state: 'failed', failure: 'timeout' }, 'network'],
    [{ state: 'failed', failure: 'rate' }, 'rate'],
    [{ state: 'failed', failure: 'status' }, 'status'],
  ] as Array<[BackupRestoreResult, RestoreNotice]>)('says %j as %s, the focus on "Restore" to try again', async (result, notice) => {
    const s = setup();
    const call = await s.restoring();
    call.onProgress!(0.7);
    call.resolve(result);
    await s.flush();
    expect(s.restore().notice.value).toBe(notice);
    expect(s.restore().phase.value).toBe('typing');
    expect(s.fieldCount()).toBe(1);
    expect(s.at()).toBe(`${RESTORE_CODE_SCREEN} · actions 0`);
    expect(s.restart).not.toHaveBeenCalled();
    // Again: a second worker, the notice and the last progress gone meanwhile.
    s.press('OK');
    expect(s.restore().notice.value).toBeNull();
    expect(s.restore().progress.value).toBeNull();
    await s.flush();
    expect(s.calls).toHaveLength(2);
  });

  it('Cancel ends the worker and shows the field again at once; a restore found after it starts the app', async () => {
    const s = setup();
    const call = await s.restoring();
    call.onProgress!(0.5);
    s.press('OK');
    expect(call.cancel!.cancelled).toBe(true);
    expect(s.restore().phase.value).toBe('typing');
    expect(s.fieldCount()).toBe(1);
    expect(s.at()).toBe(`${RESTORE_CODE_SCREEN} · actions 0`);
    expect(s.timers[0]!.cleared).toBe(true);
    // The worker's end is read: no source, so nothing more (no notice for a cancel).
    await s.flush();
    expect(s.state.profileReads).toBe(1);
    expect(s.restore().notice.value).toBeNull();
    expect(s.restart).not.toHaveBeenCalled();
    expect(s.warn).not.toHaveBeenCalled();
    // A progress after the cancel is dropped.
    call.onProgress!(0.9);
    expect(s.restore().progress.value).toBe(0.5);
  });

  it('a cancel that came after the restore committed starts the app as a restore', async () => {
    const s = setup();
    await s.restoring();
    s.state.profile = WITH_SOURCE;
    s.press('BACK');
    expect(s.restore().phase.value).toBe('typing');
    await s.flush();
    expect(s.restart).toHaveBeenCalledTimes(1);
    expect(s.restart).toHaveBeenCalledWith(true);
    expect(s.restore().phase.value).toBe('restarting');
  });

  it('Back while restoring cancels, and stays on the screen', async () => {
    const s = setup();
    const call = await s.restoring();
    s.press('BACK');
    expect(call.cancel!.cancelled).toBe(true);
    expect(s.at()).toBe(`${RESTORE_CODE_SCREEN} · actions 0`);
    await s.flush();
    s.press('BACK');
    expect(s.at()).toBe('source · types 2');
  });

  it("a cancel then a restore at once: the first one's end leaves the second running", async () => {
    const s = setup();
    const first = await s.restoring();
    s.press('OK');
    s.press('OK');
    await s.flush();
    expect(first.cancel!.cancelled).toBe(true);
    expect(s.calls).toHaveLength(2);
    expect(s.state.profileReads).toBe(1);
    expect(s.restore().phase.value).toBe('restoring');
    expect(s.fieldCount()).toBe(0);
    s.calls[1]!.resolve({ state: 'none' });
    await s.flush();
    expect(s.restore().notice.value).toBe('none');
  });

  it('a cancel while waiting for the slot asks no worker when the slot frees', async () => {
    const s = setup({ slotHeld: true });
    s.toScreen();
    s.type(TYPED);
    s.press('OK');
    await s.flush();
    s.press('OK');
    expect(s.restore().phase.value).toBe('typing');
    s.slots[0]!();
    await s.flush();
    expect(s.calls).toHaveLength(0);
    expect(s.timers).toHaveLength(0);
    expect(s.state.profileReads).toBe(0);
  });

  it('the time limit cancels the worker and says so as the connection', async () => {
    const s = setup();
    const call = await s.restoring();
    s.timers[0]!.run();
    expect(call.cancel!.cancelled).toBe(true);
    // Still restoring until the profile is read again.
    expect(s.restore().phase.value).toBe('restoring');
    await s.flush();
    expect(s.state.profileReads).toBe(1);
    expect(s.restore().notice.value).toBe('network');
    expect(s.restore().phase.value).toBe('typing');
    expect(s.at()).toBe(`${RESTORE_CODE_SCREEN} · actions 0`);
    expect(s.warn).not.toHaveBeenCalled();
  });

  it('the time limit after the restore committed starts the app as a restore', async () => {
    const s = setup();
    await s.restoring();
    s.state.profile = WITH_SOURCE;
    s.timers[0]!.run();
    await s.flush();
    expect(s.restart).toHaveBeenCalledWith(true);
    expect(s.restore().notice.value).toBeNull();
  });

  it('a worker that died is told, the profile read again: a sourceless one is no restore', async () => {
    const s = setup();
    s.state.profile = SOURCELESS;
    const call = await s.restoring();
    const error = new Error('Backup worker failed: boom');
    call.reject(error);
    await s.flush();
    expect(s.warn).toHaveBeenCalledWith('The backup code restore failed', error);
    expect(s.restore().notice.value).toBe('other');
    expect(s.at()).toBe(`${RESTORE_CODE_SCREEN} · actions 0`);
    expect(s.timers[0]!.cleared).toBe(true);
    expect(s.restart).not.toHaveBeenCalled();
  });

  it("a worker that died with a profile that can't be read is no restore either", async () => {
    const s = setup();
    s.state.profileFails = true;
    const call = await s.restoring();
    call.reject(new Error('gone'));
    await s.flush();
    expect(s.restore().notice.value).toBe('other');
    expect(s.restart).not.toHaveBeenCalled();
  });

  it('a worker that throws at once is a worker that died', async () => {
    const s = setup();
    const thrown = new Error('no worker');
    s.host.engine.restoreBackupCode = () => {
      throw thrown;
    };
    s.toScreen();
    s.type(TYPED);
    s.press('OK');
    await s.flush();
    expect(s.warn).toHaveBeenCalledWith('The backup code restore failed', thrown);
    expect(s.restore().notice.value).toBe('other');
  });
});

describe('nothing resolves twice', () => {
  it("drops a cancelled restore's answer", async () => {
    const s = setup();
    // The answer lands at the moment of the cancel, before the cancel's rejection.
    s.state.rejectOnCancel = false;
    const call = await s.restoring();
    s.press('OK');
    call.resolve({ state: 'none' });
    await s.flush();
    expect(s.restore().notice.value).toBeNull();
    expect(s.at()).toBe(`${RESTORE_CODE_SCREEN} · actions 0`);
  });

  it("drops the first restore's late answer when a second runs", async () => {
    const s = setup();
    s.state.rejectOnCancel = false;
    const first = await s.restoring();
    s.press('OK');
    await s.flush();
    s.press('OK');
    await s.flush();
    expect(s.calls).toHaveLength(2);
    first.resolve({ state: 'failed', failure: 'rate' });
    await s.flush();
    expect(s.restore().notice.value).toBeNull();
    expect(s.restore().phase.value).toBe('restoring');
    s.calls[1]!.resolve({ state: 'none' });
    await s.flush();
    expect(s.restore().notice.value).toBe('none');
  });

  it('still starts the app when a cancelled restore answers that it restored', async () => {
    const s = setup();
    s.state.rejectOnCancel = false;
    const call = await s.restoring();
    s.press('OK');
    call.resolve({ state: 'restored', language: null, sources: 1 });
    await s.flush();
    expect(s.restart).toHaveBeenCalledTimes(1);
    expect(s.restart).toHaveBeenCalledWith(true);
  });

  it('starts the app once, whatever comes after', async () => {
    const s = setup();
    const first = await s.restoring();
    // Cancelled just after its restore committed, and a second restore asked for at once.
    s.state.profile = WITH_SOURCE;
    s.press('OK');
    s.press('OK');
    await s.flush();
    expect(s.calls).toHaveLength(2);
    expect(s.restart).toHaveBeenCalledTimes(1);
    expect(s.restart).toHaveBeenCalledWith(true);
    // The second one's answer starts nothing more.
    s.calls[1]!.resolve({ state: 'kept' });
    first.resolve({ state: 'restored', language: null, sources: 1 });
    await s.flush();
    expect(s.restore().phase.value).toBe('restarting');
    expect(s.restart).toHaveBeenCalledTimes(1);
  });

  it('a restart while a restore is current leaves it answering to nobody, even with a notice', async () => {
    const s = setup();
    s.state.rejectOnCancel = false;
    const first = await s.restoring();
    s.press('OK');
    s.press('OK');
    await s.flush();
    // The cancelled one answers that it restored: the app starts again; the second's answer is dropped.
    first.resolve({ state: 'restored', language: 'en', sources: 1 });
    await s.flush();
    s.calls[1]!.resolve({ state: 'failed', failure: 'rate' });
    await s.flush();
    expect(s.restart).toHaveBeenCalledTimes(1);
    expect(s.restore().phase.value).toBe('restarting');
    expect(s.restore().notice.value).toBeNull();
  });

  it('keys after disposing do nothing', async () => {
    const s = setup();
    await s.restoring();
    s.restore().dispose();
    expect(() => s.press('OK', 'BACK')).not.toThrow();
    await s.flush();
    expect(s.restart).not.toHaveBeenCalled();
  });

  it('disposing ends the worker; nothing settles after it', async () => {
    const s = setup();
    const call = await s.restoring();
    s.ob.dispose();
    expect(call.cancel!.cancelled).toBe(true);
    expect(s.timers[0]!.cleared).toBe(true);
    s.state.profile = WITH_SOURCE;
    await s.flush();
    expect(s.restart).not.toHaveBeenCalled();
    expect(s.restore().phase.value).toBe('restoring');
  });

  it("disposing drops any answer", async () => {
    const s = setup();
    s.state.rejectOnCancel = false;
    const call = await s.restoring();
    s.ob.dispose();
    call.resolve({ state: 'none' });
    await s.flush();
    expect(s.restore().notice.value).toBeNull();
    expect(s.restore().phase.value).toBe('restoring');
  });

  it('disposing drops a restored answer', async () => {
    const s = setup();
    const call = await s.restoring();
    s.restore().dispose();
    call.resolve({ state: 'restored', language: null, sources: 1 });
    await s.flush();
    expect(s.restart).not.toHaveBeenCalled();
  });

  it('disposing while waiting for the slot asks no worker', async () => {
    const s = setup({ slotHeld: true });
    s.toScreen();
    s.type(TYPED);
    s.press('OK');
    s.restore().dispose();
    s.slots[0]!();
    await s.flush();
    expect(s.calls).toHaveLength(0);
  });

  it('opens nothing once disposed', () => {
    const s = setup();
    s.press('OK', 'OK', 'RIGHT', 'OK');
    s.restore().dispose();
    s.restore().open();
    expect(s.at()).toBe('source · types 0');
  });
});

// --- The screen as drawn ---------------------------------------------------------------------

type Props = Record<string, unknown> & { children?: unknown };

function walk(node: unknown, out: VNode[] = []): VNode[] {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return out;
  }
  if (node === null || typeof node !== 'object' || !('props' in node)) return out;
  const v = node as VNode;
  out.push(v);
  walk((v.props as Props).children, out);
  return out;
}
const props = (v: VNode): Props => v.props as Props;
const byTestId = (root: unknown, id: string): VNode[] => walk(root).filter((v) => props(v)['data-testid'] === id || props(v).testId === id);
const byType = (root: unknown, type: unknown): VNode[] => walk(root).filter((v) => v.type === type);
const textOf = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textOf(props(node as VNode).children);
};

const en = appI18n('en-US', { isolate: false });
const ar = appI18n('ar-SA');

function zone(id: string, focused: number | null): ZoneView {
  const state = (i: number): ItemState => (i === focused ? 'focused' : 'idle');
  return {
    spec: { kind: 'list', id, axis: 'horizontal', count: 1 },
    position: { index: focused ?? 0, offset: 0 },
    active: focused !== null,
    state,
    item: (i: number) => ({ state: state(i), onHover: () => undefined, onPress: () => undefined }),
  } as unknown as ZoneView;
}

const EDIT: FieldEditing = { editing: false, onEditKey: () => undefined, onEditInput: () => undefined, onEditFocus: () => undefined, onEditBlur: () => undefined };

function draw(extra: Partial<RestoreCodeContentProps> = {}): VNode {
  return RestoreCodeContent({
    i18n: en,
    phase: 'typing',
    text: SHOWN,
    problem: null,
    notice: null,
    progress: null,
    field: zone('field', 0),
    actions: zone('actions', null),
    edit: EDIT,
    onValue: () => undefined,
    ...extra,
  }) as VNode;
}

describe('the screen as drawn', () => {
  it('marks the phase, the problem, the answer and the progress for the e2e', () => {
    expect(props(draw())).toMatchObject({ 'data-testid': 'restore-code', 'data-phase': 'typing', 'data-problem': '', 'data-notice': '', 'data-progress': '' });
    expect(props(draw({ problem: 'length', notice: 'none' }))).toMatchObject({ 'data-problem': 'length', 'data-notice': 'none' });
    expect(props(draw({ phase: 'restoring', progress: 0.5 }))).toMatchObject({ 'data-phase': 'restoring', 'data-progress': '0.5' });
    expect(props(draw({ phase: 'restarting', progress: 0 }))).toMatchObject({ 'data-phase': 'restarting', 'data-progress': '0' });
  });

  it('draws the field left to right with the code, its hint, and "Restore"', () => {
    const onValue = vi.fn();
    const page = draw({ onValue, actions: zone('actions', 0), field: zone('field', null) });
    expect(textOf(byTestId(page, 'onboarding-title'))).toBe('Restore with a backup code');
    expect(walk(page).some((v) => v.type === 'p' && textOf(v) === 'Type the code you noted down from Backup in Settings. It has 26 letters and digits.')).toBe(true);
    const fields = byType(page, TextField).map(props);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ id: CODE_FIELD, label: 'Backup code', value: SHOWN, dir: 'ltr', hint: 'Upper or lower case, with or without spaces', error: null, edit: EDIT, state: 'idle', testId: 'field-code' });
    (fields[0]!.onValue as (value: string) => void)('abc');
    expect(onValue).toHaveBeenCalledWith('abc');
    const buttons = byType(page, Button).map(props);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toMatchObject({ label: 'Restore', variant: 'primary', state: 'focused', testId: 'action-0' });
    expect(byTestId(page, 'restore-notice')).toHaveLength(0);
    expect(byType(page, ProgressBar)).toHaveLength(0);
  });

  it("puts each problem under the field", () => {
    expect(props(byType(draw({ problem: 'required' }), TextField)[0]!).error).toBe('Type your backup code.');
    expect(props(byType(draw({ problem: 'length' }), TextField)[0]!).error).toBe('A backup code has 26 letters and digits. Check that none is missing or extra.');
    expect(props(byType(draw({ problem: 'invalid' }), TextField)[0]!).error).toBe("This isn't a backup code. Check it against the one you noted down.");
    expect(codeProblemText(en.t, null)).toBeNull();
  });

  it.each([
    ['none', 'No backup was found for this code. Check it and try again.'],
    ['newer', 'This backup was made by a newer version of Lablo. Update Lablo, then restore it.'],
    ['unreadable', "It couldn't be restored. Nothing on this TV was changed."],
    ['other', "It couldn't be restored. Nothing on this TV was changed."],
    ['network', "Couldn't reach the server. Check your internet connection and try again."],
    ['rate', 'Too many tries. Wait a few minutes, then try again.'],
    ['status', 'The backup service had a problem. Try again in a few minutes.'],
  ] as Array<[RestoreNotice, string]>)('says %s over the button', (notice, text) => {
    const page = draw({ notice });
    const shown = byTestId(page, 'restore-notice');
    expect(shown).toHaveLength(1);
    expect(props(shown[0]!)).toMatchObject({ role: 'alert', 'data-notice': notice });
    expect(textOf(shown[0])).toBe(text);
    expect(restoreNoticeText(en.t, notice)).toBe(text);
    // Under the field, before the button.
    const order = walk(page).filter((v) => v.type === TextField || v === shown[0] || v.type === Button);
    expect(order.map((v) => (v.type === TextField ? 'field' : v.type === Button ? 'button' : 'notice'))).toEqual(['field', 'notice', 'button']);
  });

  it.each(['restoring', 'restarting'] as const)('while %s: "Opening your backup", the progress and "Cancel", no field', (phase) => {
    const page = draw({ phase, progress: 0.4, actions: zone('actions', 0), problem: 'length', notice: 'none' });
    expect(textOf(byTestId(page, 'onboarding-title'))).toBe('Opening your backup…');
    expect(byType(page, TextField)).toHaveLength(0);
    expect(byTestId(page, 'restore-notice')).toHaveLength(0);
    expect(byType(page, Spinner).map(props)[0]).toMatchObject({ label: 'Opening your backup…' });
    expect(byType(page, ProgressBar).map(props)[0]).toMatchObject({ value: 0.4, testId: 'restore-progress' });
    expect(byType(draw({ phase, progress: null }), ProgressBar).map(props)[0]).toMatchObject({ value: 0 });
    expect(byType(page, Button).map(props)).toEqual([expect.objectContaining({ label: 'Cancel', state: 'focused', testId: 'action-0' })]);
  });

  it('reads in Arabic, with the code itself as typed', () => {
    const page = draw({ i18n: ar, problem: 'length', notice: 'none' });
    const field = props(byType(page, TextField)[0]!);
    expect(field).toMatchObject({ value: SHOWN, dir: 'ltr', label: 'الرمز الاحتياطي' });
    expect(stripIsolates(String(field.error))).toContain('حرفًا ورقمًا');
    expect(textOf(byTestId(page, 'onboarding-title'))).toBe('الاستعادة برمز احتياطي');
    expect(textOf(byTestId(page, 'restore-notice'))).toBe('لم يُعثر على نسخة احتياطية لهذا الرمز. تحقّق منه وحاول مرة أخرى.');
    const body = walk(page).filter((v) => v.type === 'p').map((v) => stripIsolates(textOf(v)));
    expect(body.some((text) => text.indexOf('النسخ الاحتياطي') !== -1 && text.indexOf('الإعدادات') !== -1)).toBe(true);
  });
});
