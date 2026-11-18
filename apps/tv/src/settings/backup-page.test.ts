import type { VNode } from 'preact';
import { signal } from '@preact/signals';
import { stripIsolates } from '@lablo/core';
import type { BackupCallRequest, BackupPrepareRequest, BackupRestoreResult, BackupStatus, BackupSwitchRequest, BackupSwitchResult, BackupUploadResult } from '@lablo/data';
import type { ItemBinding } from '@lablo/ui';
import { Button, Dialog, Spinner, bindFocus, createNavigator } from '@lablo/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appI18n } from '../i18n';
import type { BackupNotice, BackupPageEngine, BackupPageHost } from './backup-state';
import { BACKUP_CONFIRM, BACKUP_SCREEN, codeGroups, createBackupPage, restoreNotice, showsHeld } from './backup-state';
import { BackupConfirmView, BackupView, noticeText, questionText, switchLine } from './BackupPage';
import { itemText } from './SettingsScreen';

/**
 * Settings' backup page (RELAY step 32d2b): the page's reads and actions over a fake data engine
 * and a fake upload schedule (which records its holds), and the page and its dialog as drawn,
 * called as functions (their components are not expanded). The e2e drives it in the app.
 */

const REQUEST: BackupCallRequest = { platform: 'webos', appId: 'com.lablo.iptv', secret: null, base: 'http://127.0.0.1:3100' };
const CODE = '7ABCDEFGHJKMNPQRSTVWXYZ012';
/** 2026-11-18 19:05 UTC. */
const SENT = Date.UTC(2026, 10, 18, 19, 5);

function status(patch: Partial<BackupStatus> = {}): BackupStatus {
  return { on: true, source: 'code', code: CODE, sentAt: SENT, deleting: false, ...patch };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};

interface Held<T> {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

/** A promise the test settles. */
function held<T>(): { promise: Promise<T> } & Held<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** The data engine: each call recorded, answered as set (or held when `hold`). */
class FakeEngine implements BackupPageEngine {
  readonly log: string[] = [];
  readonly statusAsks: BackupPrepareRequest[] = [];
  readonly switches: BackupSwitchRequest[] = [];
  readonly restores: BackupCallRequest[] = [];
  answers: BackupStatus[] = [status()];
  failStatus = false;
  switchAnswer: BackupSwitchResult | Error = { state: 'off', deleted: true };
  restoreAnswer: BackupRestoreResult | Error = { state: 'restored', language: 'ar', sources: 1 };
  holdStatus = false;
  readonly heldStatus: Held<BackupStatus>[] = [];

  backupStatus(request: BackupPrepareRequest): Promise<BackupStatus> {
    this.log.push('status');
    this.statusAsks.push(request);
    if (this.failStatus) return Promise.reject(new Error('no worker'));
    const answer = this.answers.length > 1 ? this.answers.shift()! : this.answers[0]!;
    if (!this.holdStatus) return Promise.resolve(answer);
    const h = held<BackupStatus>();
    this.heldStatus.push(h);
    return h.promise;
  }
  setBackup(request: BackupSwitchRequest): Promise<BackupSwitchResult> {
    this.log.push(`switch ${String(request.on)}`);
    this.switches.push(request);
    return this.switchAnswer instanceof Error ? Promise.reject(this.switchAnswer) : Promise.resolve(this.switchAnswer);
  }
  restoreHeldBackup(request: BackupCallRequest): Promise<BackupRestoreResult> {
    this.log.push('restoreHeld');
    this.restores.push(request);
    return this.restoreAnswer instanceof Error ? Promise.reject(this.restoreAnswer) : Promise.resolve(this.restoreAnswer);
  }
}

/** The app around the page: the schedule's signals, its runs and holds, quiet and the restart, all logged into the engine's log. */
function fakeHost(engine: FakeEngine) {
  const heldSignal = signal(false);
  const last = signal<BackupUploadResult | null>(null);
  let replaceAnswer: BackupUploadResult | null = { state: 'sent' };
  let restarts = 0;
  const host: BackupPageHost = {
    request: () => Promise.resolve(REQUEST),
    schedule: {
      held: heldSignal,
      last,
      uploadNow: () => {
        engine.log.push('uploadNow');
        return Promise.resolve({ state: 'sent' });
      },
      replaceNow: () => {
        engine.log.push('replaceNow');
        return Promise.resolve(replaceAnswer);
      },
      hold: <T>(job: () => Promise<T>): Promise<T> => {
        engine.log.push('hold');
        const end = (): void => {
          engine.log.push('hold end');
        };
        return job().then(
          (value) => {
            end();
            return value;
          },
          (error: unknown) => {
            end();
            throw error;
          },
        );
      },
    },
    quiet: <T>(job: () => Promise<T>): Promise<T> => {
      engine.log.push('quiet');
      return job().then((value) => {
        engine.log.push('quiet end');
        return value;
      });
    },
    restart: () => {
      restarts += 1;
      engine.log.push('restart');
    },
  };
  return {
    host,
    held: heldSignal,
    last,
    restarts: () => restarts,
    setReplace: (answer: BackupUploadResult | null) => {
      replaceAnswer = answer;
    },
  };
}

function setup(engine = new FakeEngine()) {
  const nav = createNavigator({
    root: { id: 'settings', zones: [{ kind: 'list', id: 'items', axis: 'vertical', count: 3 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  const fake = fakeHost(engine);
  const page = createBackupPage({ nav, engine, host: fake.host });
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  return { nav, engine, page, at, ...fake };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the backup page’s pure parts', () => {
  it('writes the code in groups of four from the start', () => {
    expect(codeGroups(CODE)).toBe('7ABC DEFG HJKM NPQR STVW XYZ0 12');
    expect(codeGroups('')).toBe('');
    expect(codeGroups('ABCD')).toBe('ABCD');
  });

  it('shows the held box only while on with a held backup', () => {
    expect(showsHeld(status(), true)).toBe(true);
    expect(showsHeld(status(), false)).toBe(false);
    expect(showsHeld(status({ on: false }), true)).toBe(false);
    expect(showsHeld(null, true)).toBe(false);
  });

  it('says why a restore did nothing: the server, a newer app, or anything else', () => {
    expect(restoreNotice({ state: 'failed', failure: 'network' })).toBe('restore-failed');
    expect(restoreNotice({ state: 'newer' })).toBe('restore-newer');
    expect(restoreNotice({ state: 'none' })).toBe('restore-other');
    expect(restoreNotice({ state: 'unreadable' })).toBe('restore-other');
    expect(restoreNotice({ state: 'kept' })).toBe('restore-other');
  });
});

describe('the backup page', () => {
  it('opens loading on the switch, then reads the status with the schedule’s request, without its API base', async () => {
    const t = setup();
    t.engine.holdStatus = true;
    t.page.open();
    expect(t.page.screen.value).toBe(t.nav.top);
    expect(t.at()).toBe(`${BACKUP_SCREEN} · switch 0`);
    expect(t.page.status.value).toBe('loading');
    expect(t.page.pending.value).toBe(1);
    await flush();
    expect(t.engine.statusAsks).toEqual([{ platform: 'webos', appId: 'com.lablo.iptv', secret: null }]);
    t.engine.heldStatus[0]!.resolve(status());
    await flush();
    expect(t.page.status.value).toBe('ready');
    expect(t.page.info.value).toEqual(status());
    expect(t.page.pending.value).toBe(0);
    expect(t.nav.top.zone('held').count).toBe(0);
    expect(t.nav.top.zone('switch')).toMatchObject({ count: 1, neighbours: { down: 'held' } });
    expect(t.nav.top.zone('held')).toMatchObject({ axis: 'horizontal', neighbours: { up: 'switch' } });
  });

  it("fails when the status can't be read, and says nothing more", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = setup();
    t.engine.failStatus = true;
    t.page.open();
    await flush();
    expect(t.page.status.value).toBe('failed');
    expect(t.page.info.value).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    // OK on the switch does nothing without a status.
    t.nav.handle('OK');
    expect(t.at()).toBe(`${BACKUP_SCREEN} · switch 0`);
    expect(t.engine.switches).toEqual([]);
  });

  it('reads again at each opening, and drops an older read’s answer', async () => {
    const t = setup();
    t.engine.holdStatus = true;
    t.page.open();
    t.nav.back();
    t.page.open();
    await flush();
    expect(t.engine.heldStatus).toHaveLength(2);
    t.engine.heldStatus[1]!.resolve(status({ on: false, code: null }));
    t.engine.heldStatus[0]!.resolve(status());
    await flush();
    expect(t.page.info.value).toEqual(status({ on: false, code: null }));
  });

  it('asks before turning off, the safe answer first: Cancel and Back change nothing', async () => {
    const t = setup();
    t.page.open();
    await flush();
    t.nav.handle('OK');
    expect(t.at()).toBe(`${BACKUP_CONFIRM} · actions 1`);
    expect(t.page.question.value).toBe('off');
    t.nav.handle('OK');
    expect(t.at()).toBe(`${BACKUP_SCREEN} · switch 0`);
    expect(t.page.question.value).toBeNull();
    t.nav.handle('OK');
    t.nav.handle('BACK');
    expect(t.at()).toBe(`${BACKUP_SCREEN} · switch 0`);
    expect(t.page.question.value).toBeNull();
    expect(t.engine.switches).toEqual([]);
  });

  it('turns off inside the schedule’s hold, with the full request, then reads the status again', async () => {
    const t = setup();
    t.engine.answers = [status(), status({ on: false, code: null, sentAt: null, deleting: true })];
    t.page.open();
    await flush();
    t.nav.handle('OK');
    t.nav.handle('LEFT');
    expect(t.at()).toBe(`${BACKUP_CONFIRM} · actions 0`);
    t.nav.handle('OK');
    expect(t.at()).toBe(`${BACKUP_SCREEN} · switch 0`);
    expect(t.page.busy.value).toBe('off');
    expect(t.page.pending.value).toBeGreaterThan(0);
    await flush();
    expect(t.engine.switches).toEqual([{ platform: 'webos', appId: 'com.lablo.iptv', secret: null, base: 'http://127.0.0.1:3100', on: false }]);
    expect(t.engine.log).toEqual(['status', 'hold', 'switch false', 'hold end', 'status']);
    expect(t.page.busy.value).toBeNull();
    expect(t.page.notice.value).toBeNull();
    expect(t.page.info.value).toMatchObject({ on: false, deleting: true });
    expect(t.page.pending.value).toBe(0);
  });

  it("says so when the backup couldn't be turned off, and reads the status again", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = setup();
    t.engine.switchAnswer = new Error('worker died');
    t.page.open();
    await flush();
    t.nav.handle('OK');
    t.nav.handle('LEFT');
    t.nav.handle('OK');
    await flush();
    expect(t.page.notice.value).toBe('off-failed');
    expect(t.page.busy.value).toBeNull();
    expect(t.engine.log).toEqual(['status', 'hold', 'switch false', 'hold end', 'status']);
  });

  it('turns on with no question, then sends at once after the hold', async () => {
    const t = setup();
    t.engine.answers = [status({ on: false, code: null }), status()];
    t.engine.switchAnswer = { state: 'on' };
    t.page.open();
    await flush();
    t.nav.handle('OK');
    expect(t.at()).toBe(`${BACKUP_SCREEN} · switch 0`);
    expect(t.page.busy.value).toBe('on');
    await flush();
    expect(t.engine.log).toEqual(['status', 'hold', 'switch true', 'hold end', 'uploadNow', 'status']);
    expect(t.page.busy.value).toBeNull();
    expect(t.page.info.value).toEqual(status());
  });

  it("says so when the backup couldn't be turned on", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = setup();
    t.engine.answers = [status({ on: false, code: null })];
    t.engine.switchAnswer = new Error('no IndexedDB');
    t.page.open();
    await flush();
    t.nav.handle('OK');
    await flush();
    expect(t.page.notice.value).toBe('on-failed');
    expect(t.engine.log).not.toContain('uploadNow');
  });

  it('starts no second action while one runs', async () => {
    const t = setup();
    t.engine.answers = [status({ on: false, code: null })];
    t.engine.switchAnswer = { state: 'on' };
    t.page.open();
    await flush();
    t.nav.handle('OK');
    t.nav.handle('OK');
    await flush();
    expect(t.engine.switches).toHaveLength(1);
  });

  it('shows the held box’s buttons while on and held, and moves the focus up when they go', async () => {
    const t = setup();
    t.page.open();
    await flush();
    t.held.value = true;
    expect(t.nav.top.zone('held').count).toBe(2);
    t.nav.handle('DOWN');
    expect(t.at()).toBe(`${BACKUP_SCREEN} · held 0`);
    t.nav.handle('RIGHT');
    expect(t.at()).toBe(`${BACKUP_SCREEN} · held 1`);
    t.held.value = false;
    expect(t.nav.top.zone('held').count).toBe(0);
    expect(t.at()).toBe(`${BACKUP_SCREEN} · switch 0`);
    // Held, but off: no box.
    t.held.value = true;
    expect(t.nav.top.zone('held').count).toBe(2);
    t.engine.answers = [status({ on: false, code: null })];
    t.page.open();
    await flush();
    expect(t.nav.top.zone('held').count).toBe(0);
  });

  it('asks before "Restore it", then restores inside the hold and the quiet, and starts the app again', async () => {
    const t = setup();
    t.page.open();
    await flush();
    t.held.value = true;
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    expect(t.at()).toBe(`${BACKUP_CONFIRM} · actions 1`);
    expect(t.page.question.value).toBe('restore');
    t.nav.handle('LEFT');
    t.nav.handle('OK');
    expect(t.page.busy.value).toBe('restore');
    await flush();
    expect(t.engine.restores).toEqual([REQUEST]);
    expect(t.engine.log).toEqual(['status', 'hold', 'quiet', 'restoreHeld', 'restart', 'quiet end', 'hold end']);
    expect(t.restarts()).toBe(1);
    // The app is starting again: the page stays as it is, its status not read again.
    expect(t.page.busy.value).toBe('restore');
    expect(t.page.pending.value).toBe(0);
  });

  it.each([
    [{ state: 'newer' } as BackupRestoreResult, 'restore-newer'],
    [{ state: 'failed', failure: 'timeout' } as BackupRestoreResult, 'restore-failed'],
    [{ state: 'none' } as BackupRestoreResult, 'restore-other'],
    [{ state: 'kept' } as BackupRestoreResult, 'restore-other'],
    [new Error('worker died'), 'restore-failed'],
  ])('says why a restore did nothing (%o), and reads the status again', async (answer, notice) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = setup();
    t.engine.restoreAnswer = answer;
    t.page.open();
    await flush();
    t.held.value = true;
    t.nav.handle('DOWN');
    t.nav.handle('OK');
    t.nav.handle('LEFT');
    t.nav.handle('OK');
    await flush();
    expect(t.page.notice.value).toBe(notice as BackupNotice);
    expect(t.restarts()).toBe(0);
    expect(t.page.busy.value).toBeNull();
    expect(t.engine.log[t.engine.log.length - 1]).toBe('status');
  });

  it('asks before "Replace it", then has the schedule replace, and reads the status again', async () => {
    const t = setup();
    t.page.open();
    await flush();
    t.held.value = true;
    t.nav.handle('DOWN');
    t.nav.handle('RIGHT');
    t.nav.handle('OK');
    expect(t.at()).toBe(`${BACKUP_CONFIRM} · actions 1`);
    expect(t.page.question.value).toBe('replace');
    t.nav.handle('LEFT');
    t.nav.handle('OK');
    expect(t.page.busy.value).toBe('replace');
    await flush();
    expect(t.engine.log).toEqual(['status', 'replaceNow', 'status']);
    expect(t.page.notice.value).toBeNull();
    expect(t.page.busy.value).toBeNull();
  });

  it.each([[{ state: 'failed', failure: 'network' } as BackupUploadResult], [null]])("says so when the replace didn't send (%o)", async (answer) => {
    const t = setup();
    t.setReplace(answer);
    t.page.open();
    await flush();
    t.held.value = true;
    t.nav.handle('DOWN');
    t.nav.handle('RIGHT');
    t.nav.handle('OK');
    t.nav.handle('LEFT');
    t.nav.handle('OK');
    await flush();
    expect(t.page.notice.value).toBe('replace-failed');
  });

  it('clears the notice at the next action and the next opening', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = setup();
    t.engine.answers = [status({ on: false, code: null })];
    t.engine.switchAnswer = new Error('no IndexedDB');
    t.page.open();
    await flush();
    t.nav.handle('OK');
    await flush();
    expect(t.page.notice.value).toBe('on-failed');
    t.engine.switchAnswer = { state: 'on' };
    t.nav.handle('OK');
    expect(t.page.notice.value).toBeNull();
    await flush();
    t.engine.switchAnswer = new Error('no IndexedDB');
    t.nav.handle('OK');
    await flush();
    expect(t.page.notice.value).toBe('on-failed');
    t.nav.back();
    t.page.open();
    expect(t.page.notice.value).toBeNull();
  });

  it('drops what answers after a dispose, and follows the schedule no more', async () => {
    const t = setup();
    t.engine.holdStatus = true;
    t.page.open();
    await flush();
    t.page.dispose();
    t.engine.heldStatus[0]!.resolve(status());
    await flush();
    expect(t.page.status.value).toBe('loading');
    expect(t.page.info.value).toBeNull();
    t.page.open();
    expect(t.engine.heldStatus).toHaveLength(1);
  });
});

type Props = Record<string, unknown> & { children?: unknown };

/** Every element under `node` (components not expanded), depth first. */
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
const byTestId = (root: unknown, id: string): VNode[] => walk(root).filter((v) => (v.props as Props)['data-testid'] === id || (v.props as Props).testId === id);
/** The text under `node`, in order. */
const textOf = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textOf(((node as VNode).props as Props).children);
};

const en = appI18n('en-US', { isolate: false });
const ar = appI18n('ar-SA');
const item: ItemBinding = { state: 'focused', onHover: () => undefined, onPress: () => undefined };
const idle: ItemBinding = { state: 'idle', onHover: () => undefined, onPress: () => undefined };

describe('the backup page’s words', () => {
  it('names the settings row', () => {
    expect(itemText(en.t, 'backup')).toEqual({ name: 'Backup', hint: 'An encrypted copy of your sources and settings, and its code' });
    expect(itemText(ar.t, 'backup').name).toBe('النسخ الاحتياطي');
  });

  it('says under the switch what runs, the last failure, or when the copy was last written; off, whether its copy is still to delete', () => {
    const at = new Date(SENT);
    expect(switchLine(en, status(), null, null)).toBe(`Last backed up ${en.date(at, 'day')}, ${en.time(at)}`);
    expect(switchLine(en, status({ sentAt: null }), null, null)).toBe('Not backed up yet');
    expect(switchLine(en, status(), { state: 'sent' }, null)).toBe(`Last backed up ${en.date(at, 'day')}, ${en.time(at)}`);
    expect(switchLine(en, status(), { state: 'failed', failure: 'network' }, null)).toBe('The last try to send it failed. Lablo tries again in a few minutes.');
    expect(switchLine(en, status(), { state: 'too-large' }, null)).toBe('Not backed up: your sources and settings are too large.');
    expect(switchLine(en, status({ on: false }), { state: 'failed', failure: 'network' }, null)).toBe('Nothing is sent while it is off.');
    expect(switchLine(en, status({ on: false, deleting: true }), null, null)).toBe('The copy on the server is deleted as soon as Lablo can reach it.');
    expect(switchLine(en, status(), null, 'off')).toBe('Turning off…');
    expect(switchLine(en, status({ on: false }), null, 'on')).toBe('Turning on and sending…');
    expect(switchLine(en, status(), null, 'replace')).toBe(`Last backed up ${en.date(at, 'day')}, ${en.time(at)}`);
    expect(stripIsolates(switchLine(ar, status(), null, null))).toBe(`آخر نسخ احتياطي ${ar.date(at, 'day')}، ${ar.time(at)}`);
  });

  it('says what an action that didn’t work means', () => {
    const notices: BackupNotice[] = ['off-failed', 'on-failed', 'replace-failed', 'restore-failed', 'restore-newer', 'restore-other'];
    expect(notices.map((n) => noticeText(en.t, n))).toEqual([
      "Couldn't turn the backup off. Try again.",
      "Couldn't turn the backup on. Try again.",
      "Couldn't send it. Check your internet connection and try again.",
      "Couldn't reach the server. Check your internet connection and try again.",
      'This backup was made by a newer version of Lablo. Update Lablo, then restore it.',
      "It couldn't be restored. Nothing on this TV was changed.",
    ]);
    expect(noticeText(ar.t, 'restore-other')).toBe('تعذّرت استعادتها. لم يتغير شيء على هذا التلفاز.');
  });

  it('asks each question in words, off and replace on a danger button', () => {
    expect(questionText(en.t, 'off')).toEqual({ title: 'Turn off backup?', body: 'The copy on the server is deleted now. Your sources stay on this TV.', confirm: 'Turn off', danger: true });
    expect(questionText(en.t, 'restore')).toEqual({
      title: 'Restore this backup?',
      body: 'The sources, favourites and settings on this TV now are replaced by the ones in the backup, and Lablo starts again.',
      confirm: 'Restore',
      danger: false,
    });
    expect(questionText(en.t, 'replace')).toEqual({
      title: 'Replace the backup on the server?',
      body: "It is replaced by what's on this TV now. What the old backup holds can't be brought back.",
      confirm: 'Replace',
      danger: true,
    });
    expect(questionText(ar.t, 'off').title).toBe('إيقاف النسخ الاحتياطي؟');
  });
});

describe('the backup page as drawn', () => {
  async function drawn(engine = new FakeEngine()) {
    const t = setup(engine);
    t.page.open();
    await flush();
    bindFocus(t.nav);
    return { ...t, draw: (i18n = en) => BackupView({ i18n, page: t.page, switchItem: item, heldItem: (i) => (i === 0 ? item : idle) }) };
  }

  it('shows a spinner while it reads, and says so when it can’t', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new FakeEngine();
    engine.holdStatus = true;
    const t = await drawn(engine);
    let root = t.draw();
    expect(root.props as Props).toMatchObject({ 'data-testid': 'backup', 'data-status': 'loading', 'data-on': '', 'data-held': 'false' });
    expect(walk(root).filter((v) => v.type === Spinner)).toHaveLength(1);
    expect(byTestId(root, 'backup-switch')).toHaveLength(0);
    expect(textOf(walk(root).filter((v) => v.type === 'h1')[0])).toBe('Backup');
    expect(textOf(walk(root).filter((v) => v.type === 'p')[0])).toBe('An encrypted copy of your sources, favourites and settings, so they come back after an app update or a reset.');
    engine.heldStatus[0]!.reject(new Error('no worker'));
    await flush();
    root = t.draw();
    expect(root.props as Props).toMatchObject({ 'data-status': 'failed' });
    expect(textOf(byTestId(root, 'backup-failed')[0])).toBe("Couldn't read the backup's settings.");
    expect(walk(root).filter((v) => v.type === Spinner)).toHaveLength(0);
  });

  it('draws the switch, and the code in groups as data while it is the secret', async () => {
    const t = await drawn();
    const root = t.draw();
    expect(root.props as Props).toMatchObject({ 'data-status': 'ready', 'data-on': 'true', 'data-source': 'code', 'data-sent': SENT, 'data-deleting': 'false', 'data-busy': '', 'data-notice': '' });
    const row = byTestId(root, 'backup-switch')[0]!;
    expect(row.props as Props).toMatchObject({ role: 'switch', 'aria-checked': 'true', 'data-state': 'focused', class: 'settings__row backup__switch is-focused' });
    expect(textOf(byTestId(root, 'backup-value')[0])).toBe('On');
    const code = byTestId(root, 'backup-code')[0]!;
    expect(code.props as Props).toMatchObject({ dir: 'ltr', translate: false, 'data-code': CODE });
    expect(textOf(code)).toBe('7ABC DEFG HJKM NPQR STVW XYZ0 12');
    expect(textOf(byTestId(root, 'backup-code-box')[0])).toContain("Note it down or take a photo of it. If this TV's app data is ever reset, you'll need it to get your backup back.");
    expect(byTestId(root, 'backup-held')).toHaveLength(0);
    expect(byTestId(root, 'backup-notice')).toHaveLength(0);
    expect(textOf(walk(t.draw(ar)).filter((v) => v.type === 'h2')[0])).toBe('رمزك الاحتياطي');
  });

  it('shows no code with the device ID as the secret, nor while off', async () => {
    const engine = new FakeEngine();
    engine.answers = [status({ source: 'device', code: null })];
    let t = await drawn(engine);
    expect(byTestId(t.draw(), 'backup-code-box')).toHaveLength(0);
    // (The worker gives no code while off; the page wouldn't draw one anyway.)
    const off = new FakeEngine();
    off.answers = [status({ on: false })];
    t = await drawn(off);
    const root = t.draw();
    expect(byTestId(root, 'backup-code-box')).toHaveLength(0);
    expect(textOf(byTestId(root, 'backup-value')[0])).toBe('Off');
    expect(byTestId(root, 'backup-switch')[0]!.props as Props).toMatchObject({ 'aria-checked': 'false' });
  });

  it('draws the held box with its two buttons, dimmed with a line while an action runs', async () => {
    const engine = new FakeEngine();
    engine.answers = [status({ source: 'device', code: null })];
    const t = await drawn(engine);
    t.held.value = true;
    let root = t.draw();
    expect(root.props as Props).toMatchObject({ 'data-held': 'true' });
    const box = byTestId(root, 'backup-held')[0]!;
    expect(textOf(walk(box).filter((v) => v.type === 'h2')[0])).toBe('Another backup of this TV is on the server');
    const buttons = walk(box).filter((v) => v.type === Button);
    expect(buttons.map((b) => [(b.props as Props).label, (b.props as Props).variant, (b.props as Props).disabled, (b.props as Props).testId, (b.props as Props).state])).toEqual([
      ['Restore it', 'primary', false, 'backup-restore', 'focused'],
      ['Replace it', undefined, false, 'backup-replace', 'idle'],
    ]);
    expect(byTestId(root, 'backup-busy')).toHaveLength(0);
    // "Replace it" confirmed: drawn before its answer.
    t.nav.handle('DOWN');
    t.nav.handle('RIGHT');
    t.nav.handle('OK');
    t.nav.handle('LEFT');
    t.nav.handle('OK');
    root = t.draw();
    expect(root.props as Props).toMatchObject({ 'data-busy': 'replace' });
    expect(walk(byTestId(root, 'backup-held')[0]).filter((v) => v.type === Button).map((b) => (b.props as Props).disabled)).toEqual([true, true]);
    expect(textOf(byTestId(root, 'backup-busy')[0])).toBe('Sending…');
  });

  it('draws the notice in the warning colour', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new FakeEngine();
    engine.switchAnswer = new Error('worker died');
    const t = await drawn(engine);
    t.nav.handle('OK');
    t.nav.handle('LEFT');
    t.nav.handle('OK');
    await flush();
    const root = t.draw();
    expect(root.props as Props).toMatchObject({ 'data-notice': 'off-failed' });
    const notice = byTestId(root, 'backup-notice')[0]!;
    expect((notice.props as Props).class).toBe('guides__failure backup__notice');
    expect(textOf(notice)).toBe("Couldn't turn the backup off. Try again.");
  });

  it('draws the dialog it is given inside the page', async () => {
    const t = await drawn();
    const dialog = BackupConfirmView({ i18n: en, question: 'off', item: () => idle });
    const root = BackupView({ i18n: en, page: t.page, switchItem: item, heldItem: () => idle, dialog });
    expect(walk(root)).toContain(dialog);
  });
});

describe('the confirm dialog as drawn', () => {
  it('has the confirm first and Cancel second, with the question’s words', () => {
    const states: ItemBinding[] = [idle, item];
    const off = BackupConfirmView({ i18n: en, question: 'off', item: (i) => states[i]! });
    expect(off.type).toBe(Dialog);
    expect(off.props as Props).toMatchObject({ title: 'Turn off backup?', message: 'The copy on the server is deleted now. Your sources stay on this TV.', testId: 'backup-confirm' });
    const buttons = walk(off).filter((v) => v.type === Button);
    expect(buttons.map((b) => [(b.props as Props).label, (b.props as Props).variant, (b.props as Props).testId, (b.props as Props).state])).toEqual([
      ['Turn off', 'danger', 'backup-confirm-yes', 'idle'],
      ['Cancel', undefined, 'backup-confirm-no', 'focused'],
    ]);
    const restore = BackupConfirmView({ i18n: ar, question: 'restore', item: () => idle });
    expect(walk(restore).filter((v) => v.type === Button).map((b) => [(b.props as Props).label, (b.props as Props).variant])).toEqual([
      ['استعادة', 'primary'],
      ['إلغاء', undefined],
    ]);
    expect((BackupConfirmView({ i18n: en, question: 'replace', item: () => idle }).props as Props).title).toBe('Replace the backup on the server?');
  });
});
