import type { VNode } from 'preact';
import type { LoadedProfile } from '@lablo/data';
import type { BackupCallRequest, BackupRestoreResult, CancelToken } from '@lablo/data/client';
import { CancelError } from '@lablo/data/client';
import { stripIsolates } from '@lablo/core';
import { describe, expect, it } from 'vitest';
import type { SchedulerTimers } from '../data/refresh-scheduler';
import { appI18n } from '../i18n';
import type { BackupStart, BackupStartEngine, BackupStartEnd } from './backup-start';
import { LOOKUP_LIMIT_MS, LOOKING_SCREEN, WELCOME_MS, WELCOME_SCREEN, createBackupStart } from './backup-start';
import { BackupStartView, startLocale } from './BackupStartApp';

// RELAY step 32c2: "Looking for your backup" at a start with no profile, then "Welcome back" or
// onboarding.

const REQUEST: BackupCallRequest = { platform: 'webos', appId: 'com.lablo.iptv', secret: 'LGUDID-1', base: 'http://127.0.0.1:3100' };

function profileWith(sources: { id: string; type: string }[], language: string | null = 'ar'): LoadedProfile {
  return { doc: { v: 8, onboarding: { language, disclaimerAt: 1, consent: true }, sources } as never, newer: false, migratedFrom: null };
}
const RESTORED = profileWith([
  { id: 's1', type: 'xtream' },
  { id: 's2', type: 'm3u-file' },
]);

/** A data engine whose look-up the test settles; a cancel rejects it as the worker's client does. */
class FakeEngine implements BackupStartEngine {
  requests: BackupCallRequest[] = [];
  progress: ((fraction: number) => void) | null = null;
  cancel: CancelToken | null = null;
  settle: { resolve(r: BackupRestoreResult): void; reject(error: unknown): void } | null = null;
  /** What `profile()` answers (a function: read when asked). */
  stored: () => Promise<LoadedProfile | null> = () => Promise.resolve(null);
  profileReads = 0;
  restoreBackup(request: BackupCallRequest, options: { readonly onProgress?: (fraction: number) => void; readonly cancel?: CancelToken }): Promise<BackupRestoreResult> {
    this.requests.push(request);
    this.progress = options.onProgress ?? null;
    this.cancel = options.cancel ?? null;
    return new Promise<BackupRestoreResult>((resolve, reject) => {
      this.settle = { resolve, reject };
      options.cancel?.onCancel(() => reject(new CancelError()));
    });
  }
  profile(): Promise<LoadedProfile | null> {
    this.profileReads++;
    return this.stored();
  }
}

function manualTimers() {
  let now = 0;
  let seq = 0;
  const queue: { id: number; at: number; run: () => void }[] = [];
  const timers: SchedulerTimers = {
    set: (run, ms) => {
      seq += 1;
      queue.push({ id: seq, at: now + ms, run });
      return seq;
    },
    clear: (handle) => {
      const i = queue.findIndex((t) => t.id === handle);
      if (i !== -1) queue.splice(i, 1);
    },
  };
  return {
    timers,
    due: () => queue.map((t) => t.at - now).sort((a, b) => a - b),
    advance(ms: number): void {
      const end = now + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at || a.id - b.id);
        const next = queue[0];
        if (next === undefined || next.at > end) break;
        queue.shift();
        now = next.at;
        next.run();
      }
      now = end;
    },
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function setup() {
  const engine = new FakeEngine();
  const clock = manualTimers();
  const warnings: [string, unknown][] = [];
  const start = createBackupStart({ engine, request: REQUEST, timers: clock.timers, warn: (message, detail) => warnings.push([message, detail]) });
  let end: BackupStartEnd | null = null;
  void start.done.then((value) => {
    end = value;
  });
  return { engine, clock, start, warnings, end: () => end };
}

describe('createBackupStart', () => {
  it('pins its timings: a 30 s limit, "Welcome back" for 5 s', () => {
    expect(LOOKUP_LIMIT_MS).toBe(30_000);
    expect(WELCOME_MS).toBe(5_000);
  });

  it('looks up with the request as given, shows scrypt’s progress, and times the limit', () => {
    const s = setup();
    expect(s.engine.requests).toEqual([REQUEST]);
    expect(s.start.screen.value).toBe(LOOKING_SCREEN);
    expect(s.start.nav.top.id).toBe(LOOKING_SCREEN);
    expect(s.start.progress.value).toBeNull();
    s.engine.progress?.(0.25);
    expect(s.start.progress.value).toBe(0.25);
    expect(s.clock.due()).toEqual([LOOKUP_LIMIT_MS]);
    expect(s.start.skipped.value).toBe(false);
  });

  it('shows "Welcome back" when the profile came back, in its language, for 5 s', async () => {
    const s = setup();
    s.engine.stored = () => Promise.resolve(RESTORED);
    s.engine.settle?.resolve({ state: 'restored', language: 'ar', sources: 2 });
    await flush();
    expect(s.engine.profileReads).toBe(1);
    expect(s.start.screen.value).toBe(WELCOME_SCREEN);
    expect(s.start.nav.top.id).toBe(WELCOME_SCREEN);
    expect(s.start.language.value).toBe('ar');
    expect(s.start.sources.value).toBe(2);
    expect(s.start.files.value).toBe(1);
    // The limit went with the look-up; the welcome's 5 s run.
    expect(s.clock.due()).toEqual([WELCOME_MS]);
    s.clock.advance(WELCOME_MS - 1);
    await flush();
    expect(s.end()).toBeNull();
    s.clock.advance(1);
    await flush();
    expect(s.end()).toEqual({ profile: RESTORED, restored: true, toSources: false, toGuides: false });
    expect(s.warnings).toEqual([]);
  });

  it('goes on at once on OK or Back on "Welcome back", and only once', async () => {
    for (const intent of ['OK', 'BACK'] as const) {
      const s = setup();
      s.engine.stored = () => Promise.resolve(profileWith([{ id: 's1', type: 'm3u' }], null));
      s.engine.settle?.resolve({ state: 'restored', language: null, sources: 1 });
      await flush();
      expect(s.start.language.value).toBeNull();
      expect(s.start.files.value).toBe(0);
      s.start.nav.handle(intent);
      await flush();
      expect(s.end()?.restored).toBe(true);
      expect(s.clock.due()).toEqual([]);
      s.start.nav.handle('OK');
      s.clock.advance(WELCOME_MS);
      await flush();
    }
  });

  it('ends for onboarding when nothing came back, telling only the answers that say something went wrong', async () => {
    const cases: [BackupRestoreResult, [string, unknown][]][] = [
      [{ state: 'none' }, []],
      [{ state: 'kept' }, []],
      [{ state: 'unreadable' }, [['No backup was restored', 'unreadable']]],
      [{ state: 'newer' }, [['No backup was restored', 'newer']]],
      [{ state: 'failed', failure: 'network' }, [['No backup was restored', 'failed: network']]],
    ];
    for (const [result, told] of cases) {
      const s = setup();
      s.engine.settle?.resolve(result);
      await flush();
      expect(s.end()).toEqual({ profile: null, restored: false, toSources: false, toGuides: false });
      expect(s.start.screen.value).toBe(LOOKING_SCREEN);
      expect(s.warnings).toEqual(told);
      expect(s.clock.due()).toEqual([]);
    }
  });

  it('reads a profile with no source as no restore', async () => {
    const s = setup();
    const answered = profileWith([], 'en');
    s.engine.stored = () => Promise.resolve(answered);
    s.engine.settle?.resolve({ state: 'kept' });
    await flush();
    expect(s.end()).toEqual({ profile: answered, restored: false, toSources: false, toGuides: false });
  });

  it('cancels on Skip or Back, then reads the profile: onboarding', async () => {
    for (const intent of ['OK', 'BACK'] as const) {
      const s = setup();
      s.start.nav.handle(intent);
      expect(s.start.skipped.value).toBe(true);
      expect(s.engine.cancel?.cancelled).toBe(true);
      await flush();
      expect(s.engine.profileReads).toBe(1);
      expect(s.end()).toEqual({ profile: null, restored: false, toSources: false, toGuides: false });
      // A cancel is no news.
      expect(s.warnings).toEqual([]);
      // A second press does nothing more.
      s.start.nav.handle('OK');
      await flush();
      expect(s.engine.profileReads).toBe(1);
    }
  });

  it('cancels at the time limit', async () => {
    const s = setup();
    s.clock.advance(LOOKUP_LIMIT_MS - 1);
    expect(s.engine.cancel?.cancelled).toBe(false);
    s.clock.advance(1);
    expect(s.engine.cancel?.cancelled).toBe(true);
    // Not a skip.
    expect(s.start.skipped.value).toBe(false);
    await flush();
    expect(s.end()).toEqual({ profile: null, restored: false, toSources: false, toGuides: false });
  });

  it('shows "Welcome back" when a restore committed just before the cancel', async () => {
    const s = setup();
    s.engine.stored = () => Promise.resolve(RESTORED);
    s.clock.advance(LOOKUP_LIMIT_MS);
    await flush();
    expect(s.start.screen.value).toBe(WELCOME_SCREEN);
    s.clock.advance(WELCOME_MS);
    await flush();
    expect(s.end()).toEqual({ profile: RESTORED, restored: true, toSources: false, toGuides: false });
  });

  it('tells a worker that died, and reads the profile all the same', async () => {
    const s = setup();
    const died = new Error('Backup worker failed: boom');
    s.engine.settle?.reject(died);
    await flush();
    expect(s.warnings).toEqual([['The backup look-up failed', died]]);
    expect(s.end()).toEqual({ profile: null, restored: false, toSources: false, toGuides: false });
  });

  it('starts onboarding when the profile cannot be read after the look-up', async () => {
    const s = setup();
    const broken = new Error('no IndexedDB');
    s.engine.stored = () => Promise.reject(broken);
    s.engine.settle?.resolve({ state: 'none' });
    await flush();
    expect(s.warnings).toEqual([['The profile could not be read after the backup look-up', broken]]);
    expect(s.end()).toEqual({ profile: null, restored: false, toSources: false, toGuides: false });
  });

  it('once disposed, cancels the look-up and settles nothing', async () => {
    const s = setup();
    s.start.dispose();
    expect(s.engine.cancel?.cancelled).toBe(true);
    expect(s.clock.due()).toEqual([]);
    s.engine.progress?.(0.5);
    expect(s.start.progress.value).toBeNull();
    await flush();
    expect(s.engine.profileReads).toBe(0);
    expect(s.end()).toBeNull();
    s.start.dispose();
  });

  it('once disposed while the profile is read again, settles nothing and times nothing', async () => {
    const s = setup();
    let read: (profile: LoadedProfile | null) => void = () => undefined;
    s.engine.stored = () =>
      new Promise<LoadedProfile | null>((resolve) => {
        read = resolve;
      });
    s.engine.settle?.resolve({ state: 'restored', language: 'ar', sources: 2 });
    await flush();
    expect(s.engine.profileReads).toBe(1);
    s.start.dispose();
    read(RESTORED);
    await flush();
    expect(s.start.screen.value).toBe(LOOKING_SCREEN);
    expect(s.clock.due()).toEqual([]);
    s.clock.advance(WELCOME_MS);
    await flush();
    expect(s.end()).toBeNull();
  });

  it('once disposed on "Welcome back", settles nothing more', async () => {
    const s = setup();
    s.engine.stored = () => Promise.resolve(RESTORED);
    s.engine.settle?.resolve({ state: 'restored', language: 'ar', sources: 2 });
    await flush();
    s.start.dispose();
    expect(s.clock.due()).toEqual([]);
    expect(s.end()).toBeNull();
  });
});

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
const byTestId = (root: unknown, id: string): VNode[] => walk(root).filter((v) => (v.props as Props)['data-testid'] === id || (v.props as Props).testId === id);
const textOf = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textOf(((node as VNode).props as Props).children);
};
const ITEM = { state: 'focused' as const, onHover: () => undefined, onPress: () => undefined };
const FOCUS = { zone: 'actions', index: 0 };

async function welcomed(sources: { id: string; type: string }[]): Promise<BackupStart> {
  const s = setup();
  s.engine.stored = () => Promise.resolve(profileWith(sources));
  s.engine.settle?.resolve({ state: 'restored', language: 'ar', sources: sources.length });
  await flush();
  return s.start;
}

describe('startLocale', () => {
  it("is the TV's locale until \"Welcome back\" picks the restored language, in the TV's region", () => {
    const us = { tag: 'en-US', country: 'US' };
    expect(startLocale(us, null)).toMatchObject({ language: 'en', dir: 'ltr', tag: 'en-US' });
    expect(startLocale(us, 'en')).toMatchObject({ language: 'en', dir: 'ltr', tag: 'en-US' });
    const ar = startLocale(us, 'ar');
    expect(ar).toMatchObject({ language: 'ar', dir: 'rtl' });
    expect(ar.tag.startsWith('ar')).toBe(true);
    expect(startLocale({ tag: 'ar-SA', country: 'SA' }, 'en')).toMatchObject({ language: 'en', dir: 'ltr' });
    expect(startLocale({ tag: 'ar-SA', country: 'SA' }, null)).toMatchObject({ language: 'ar', dir: 'rtl', tag: 'ar-SA' });
  });
});

describe('BackupStartView', () => {
  it('draws "Looking for your backup" with its progress and "Skip", in English and Arabic', () => {
    const s = setup();
    s.engine.progress?.(0.5);
    const en = BackupStartView({ start: s.start, i18n: appI18n('en-US'), item: ITEM, focus: FOCUS });
    expect((en.props as Props)['data-screen']).toBe('looking');
    expect((en.props as Props)['data-progress']).toBe('0.5');
    expect((en.props as Props)['data-language']).toBe('en');
    expect((en.props as Props)['data-zone']).toBe('actions');
    expect((en.props as Props)['data-index']).toBe(0);
    expect(textOf(byTestId(en, 'backup-title')[0])).toBe('Looking for your backup');
    expect((byTestId(en, 'backup-skip')[0]!.props as Props).label).toBe('Skip');
    expect((byTestId(en, 'backup-progress')[0]!.props as Props).value).toBe(0.5);
    // The focus as the engine has it (the e2e's driver reads it from the root).
    const moved = BackupStartView({ start: s.start, i18n: appI18n('en-US'), item: ITEM, focus: { zone: 'other', index: 2 } });
    expect((moved.props as Props)['data-zone']).toBe('other');
    expect((moved.props as Props)['data-index']).toBe(2);
    const ar = BackupStartView({ start: s.start, i18n: appI18n('ar-SA'), item: ITEM, focus: FOCUS });
    expect(textOf(byTestId(ar, 'backup-title')[0])).toBe('جارٍ البحث عن نسختك الاحتياطية');
    expect((ar.props as Props)['data-language']).toBe('ar');
    // Before any progress: an empty bar.
    const fresh = setup();
    const drawn = BackupStartView({ start: fresh.start, i18n: appI18n('en-US'), item: ITEM, focus: FOCUS });
    expect((drawn.props as Props)['data-progress']).toBe('');
    expect((byTestId(drawn, 'backup-progress')[0]!.props as Props).value).toBe(0);
    expect((drawn.props as Props)['data-skipped']).toBe('false');
    fresh.start.nav.handle('OK');
    expect((BackupStartView({ start: fresh.start, i18n: appI18n('en-US'), item: ITEM, focus: FOCUS }).props as Props)['data-skipped']).toBe('true');
  });

  it('draws "Welcome back", with the line about files only when one came back', async () => {
    const both = await welcomed([
      { id: 's1', type: 'xtream' },
      { id: 's2', type: 'm3u-file' },
    ]);
    const en = BackupStartView({ start: both, i18n: appI18n('en-US'), item: ITEM, focus: FOCUS });
    expect((en.props as Props)['data-screen']).toBe('welcome');
    expect((en.props as Props)['data-zone']).toBe('actions');
    const moved = BackupStartView({ start: both, i18n: appI18n('en-US'), item: ITEM, focus: { zone: 'other', index: 2 } });
    expect((moved.props as Props)['data-zone']).toBe('other');
    expect((moved.props as Props)['data-index']).toBe(2);
    expect((en.props as Props)['data-sources']).toBe(2);
    expect((en.props as Props)['data-files']).toBe(1);
    expect(textOf(byTestId(en, 'backup-title')[0])).toBe('Welcome back');
    expect(stripIsolates(textOf(byTestId(en, 'backup-files')[0]))).toBe('Files sent from your phone need to be sent again: in Settings, open Sources, then Add from your phone.');
    expect((byTestId(en, 'backup-continue')[0]!.props as Props).label).toBe('Continue');
    const ar = BackupStartView({ start: both, i18n: appI18n('ar-SA'), item: ITEM, focus: FOCUS });
    expect(textOf(byTestId(ar, 'backup-title')[0])).toBe('مرحبًا بعودتك');
    expect(stripIsolates(textOf(byTestId(ar, 'backup-files')[0]))).toBe('يجب إرسال الملفات المرسلة من هاتفك مرة أخرى: في الإعدادات، افتح المصادر، ثم أضف من هاتفك.');
    const links = await welcomed([{ id: 's1', type: 'm3u' }]);
    expect(byTestId(BackupStartView({ start: links, i18n: appI18n('en-US'), item: ITEM, focus: FOCUS }), 'backup-files')).toEqual([]);
  });
});

/** Sources as a backup made without logins brings them back (step 32d4a). */
const WITHOUT_LOGINS = [
  { id: 's1', type: 'xtream', name: 'Panel', account: null, base: 'http://panel.example:8080', added: 1 },
  { id: 's2', type: 'm3u', name: 'List', url: null, origin: 'http://list.example', added: 2 },
  { id: 's3', type: 'm3u-file', name: 'Phone', added: 3 },
  { id: 's4', type: 'm3u', name: 'Kept', url: 'http://kept.example/a.m3u', added: 4 },
  { id: 's5', type: 'xtream', name: 'Given', account: { base: 'http://given.example', username: 'u', password: 'p' }, added: 5 },
];

describe('"Welcome back" with sources missing their login (RELAY step 32d4b)', () => {
  it('counts them, and its end opens the sources screen, however it comes', async () => {
    for (const how of ['time', 'OK', 'BACK'] as const) {
      const s = setup();
      const profile = profileWith(WITHOUT_LOGINS);
      s.engine.stored = () => Promise.resolve(profile);
      s.engine.settle?.resolve({ state: 'restored', language: 'en', sources: 5 });
      await flush();
      expect(s.start.sources.value).toBe(5);
      expect(s.start.files.value).toBe(1);
      expect(s.start.logins.value).toBe(2);
      // Its 5 s still run: the restore needs no key.
      expect(s.clock.due()).toEqual([WELCOME_MS]);
      if (how === 'time') s.clock.advance(WELCOME_MS);
      else s.start.nav.handle(how);
      await flush();
      expect(s.end()).toEqual({ profile, restored: true, toSources: true, toGuides: false });
    }
  });

  it('counts one, and none when every source has its login', async () => {
    const one = await welcomed([WITHOUT_LOGINS[0]!, WITHOUT_LOGINS[4]!]);
    expect(one.logins.value).toBe(1);
    // One is enough for the sources screen.
    one.nav.handle('OK');
    await expect(one.done).resolves.toMatchObject({ restored: true, toSources: true, toGuides: false });
    const none = await welcomed([WITHOUT_LOGINS[2]!, WITHOUT_LOGINS[3]!, WITHOUT_LOGINS[4]!]);
    expect(none.logins.value).toBe(0);
    const s = setup();
    const profile = profileWith([WITHOUT_LOGINS[3]!]);
    s.engine.stored = () => Promise.resolve(profile);
    s.engine.settle?.resolve({ state: 'restored', language: 'en', sources: 1 });
    await flush();
    s.start.nav.handle('OK');
    await flush();
    expect(s.end()).toEqual({ profile, restored: true, toSources: false, toGuides: false });
  });

  it('counts them after Settings’ "Restore it" too', async () => {
    const profile = profileWith(WITHOUT_LOGINS);
    const start = createBackupStart({ engine: new FakeEngine(), restored: profile, timers: manualTimers().timers });
    let end: BackupStartEnd | null = null;
    void start.done.then((value) => {
      end = value;
    });
    expect(start.logins.value).toBe(2);
    start.nav.handle('OK');
    await flush();
    expect(end).toEqual({ profile, restored: true, toSources: true, toGuides: false });
  });

  it('says so in one line, in English and Arabic, with the files’ line when a file came back too', async () => {
    const start = await welcomed(WITHOUT_LOGINS);
    const en = BackupStartView({ start, i18n: appI18n('en-US'), item: ITEM, focus: FOCUS });
    expect((en.props as Props)['data-logins']).toBe(2);
    expect(stripIsolates(textOf(byTestId(en, 'backup-logins')[0]))).toBe('2 sources need their logins or links again: Sources in Settings opens next.');
    expect((byTestId(en, 'backup-logins')[0]!.props as Props).class).toBe('onboarding__note');
    expect(byTestId(en, 'backup-files')).toHaveLength(1);
    const ar = BackupStartView({ start, i18n: appI18n('ar-SA'), item: ITEM, focus: FOCUS });
    expect(stripIsolates(textOf(byTestId(ar, 'backup-logins')[0]))).toBe('يحتاج مصدران إلى بيانات الدخول أو الرابط مرة أخرى: تُفتح المصادر في الإعدادات بعد ذلك.');
    const one = await welcomed([WITHOUT_LOGINS[1]!]);
    expect(stripIsolates(textOf(byTestId(BackupStartView({ start: one, i18n: appI18n('en-US'), item: ITEM, focus: FOCUS }), 'backup-logins')[0]))).toBe(
      'One source needs its login or link again: Sources in Settings opens next.',
    );
    const none = await welcomed([WITHOUT_LOGINS[4]!]);
    const drawn = BackupStartView({ start: none, i18n: appI18n('en-US'), item: ITEM, focus: FOCUS });
    expect((drawn.props as Props)['data-logins']).toBe(0);
    expect(byTestId(drawn, 'backup-logins')).toEqual([]);
  });

  it('says the channels are loading only when a source loads by itself (not a file, not one without its login)', async () => {
    const body = (start: BackupStart, tag = 'en-US'): string => textOf(byTestId(BackupStartView({ start, i18n: appI18n(tag), item: ITEM, focus: FOCUS }), 'backup-body')[0]);
    const loading = 'Your sources, favourites and settings are back. Your channels are loading now.';
    const back = 'Your sources, favourites and settings are back.';
    expect(body(await welcomed(WITHOUT_LOGINS))).toBe(loading);
    expect(body(await welcomed([WITHOUT_LOGINS[2]!, WITHOUT_LOGINS[3]!]))).toBe(loading);
    expect(body(await welcomed([WITHOUT_LOGINS[0]!, WITHOUT_LOGINS[4]!]))).toBe(loading);
    const none = await welcomed([WITHOUT_LOGINS[0]!, WITHOUT_LOGINS[1]!, WITHOUT_LOGINS[2]!]);
    expect(body(none)).toBe(back);
    expect(body(none, 'ar-SA')).toBe('عادت مصادرك ومفضلتك وإعداداتك.');
    expect(body(await welcomed([WITHOUT_LOGINS[0]!]))).toBe(back);
    expect(body(await welcomed([WITHOUT_LOGINS[2]!]))).toBe(back);
  });
});

/** A profile with the user's guides too (step 32d4c): some without their link. */
function withGuides(sources: { id: string; type: string }[], guides: { id: string; url: string | null; origin?: string }[]): LoadedProfile {
  const profile = profileWith(sources);
  return { ...profile, doc: { ...(profile.doc as object), guides } as never };
}

const BARE_GUIDES = [
  { id: 's4', url: null, origin: 'http://guides.example' },
  { id: 'g2', url: 'http://guides.example/b.xml' },
  { id: 'g3', url: null, origin: '' },
];

describe('"Welcome back" with guides missing their link (RELAY step 32d4c)', () => {
  it('counts them, and with every source given its login, its end opens the guides screen, however it comes', async () => {
    for (const how of ['time', 'OK', 'BACK'] as const) {
      const s = setup();
      const profile = withGuides([WITHOUT_LOGINS[3]!, WITHOUT_LOGINS[4]!], BARE_GUIDES);
      s.engine.stored = () => Promise.resolve(profile);
      s.engine.settle?.resolve({ state: 'restored', language: 'en', sources: 2 });
      await flush();
      expect(s.start.guides.value).toBe(2);
      expect(s.start.logins.value).toBe(0);
      expect(s.clock.due()).toEqual([WELCOME_MS]);
      if (how === 'time') s.clock.advance(WELCOME_MS);
      else s.start.nav.handle(how);
      await flush();
      expect(s.end()).toEqual({ profile, restored: true, toSources: false, toGuides: true });
    }
  });

  it('opens the sources screen first when a source needs its login too, and neither when nothing needs anything', async () => {
    const both = withGuides([WITHOUT_LOGINS[0]!], [BARE_GUIDES[0]!]);
    const start = createBackupStart({ engine: new FakeEngine(), restored: both, timers: manualTimers().timers });
    expect([start.logins.value, start.guides.value]).toEqual([1, 1]);
    start.nav.handle('OK');
    await expect(start.done).resolves.toEqual({ profile: both, restored: true, toSources: true, toGuides: false });
    const none = withGuides([WITHOUT_LOGINS[3]!], [BARE_GUIDES[1]!]);
    const plain = createBackupStart({ engine: new FakeEngine(), restored: none, timers: manualTimers().timers });
    expect(plain.guides.value).toBe(0);
    plain.nav.handle('OK');
    await expect(plain.done).resolves.toEqual({ profile: none, restored: true, toSources: false, toGuides: false });
    // A profile with guides and no source: no restore, nothing to open.
    const empty = withGuides([], BARE_GUIDES);
    const nothing = createBackupStart({ engine: new FakeEngine(), restored: empty, timers: manualTimers().timers });
    await expect(nothing.done).resolves.toEqual({ profile: empty, restored: false, toSources: false, toGuides: false });
  });

  it('says so in a line of its own: where the guides are when Sources opens next, else that TV guides opens next', async () => {
    const draw = (start: BackupStart, tag = 'en-US') => BackupStartView({ start, i18n: appI18n(tag), item: ITEM, focus: FOCUS });
    const alone = await welcomed([WITHOUT_LOGINS[3]!]);
    expect(byTestId(draw(alone), 'backup-guides')).toEqual([]);
    expect((draw(alone).props as Props)['data-guides']).toBe(0);
    const s = setup();
    s.engine.stored = () => Promise.resolve(withGuides([WITHOUT_LOGINS[3]!], BARE_GUIDES));
    s.engine.settle?.resolve({ state: 'restored', language: 'en', sources: 1 });
    await flush();
    const next = draw(s.start);
    expect((next.props as Props)['data-guides']).toBe(2);
    const line = byTestId(next, 'backup-guides')[0]!;
    expect((line.props as Props).class).toBe('onboarding__note');
    expect(stripIsolates(textOf(line))).toBe('2 TV guides need their links again: TV guides in Settings opens next.');
    expect(stripIsolates(textOf(byTestId(draw(s.start, 'ar-SA'), 'backup-guides')[0]))).toBe('يحتاج دليلان إلى الرابط مرة أخرى: تُفتح أدلة التلفزيون في الإعدادات بعد ذلك.');
    const t = setup();
    t.engine.stored = () => Promise.resolve(withGuides([WITHOUT_LOGINS[0]!], [BARE_GUIDES[0]!]));
    t.engine.settle?.resolve({ state: 'restored', language: 'en', sources: 1 });
    await flush();
    const after = draw(t.start);
    expect(byTestId(after, 'backup-logins')).toHaveLength(1);
    expect(stripIsolates(textOf(byTestId(after, 'backup-guides')[0]))).toBe('One TV guide needs its link again: in Settings, open TV guides.');
    expect(stripIsolates(textOf(byTestId(draw(t.start, 'ar-SA'), 'backup-guides')[0]))).toBe('يحتاج دليل واحد إلى الرابط مرة أخرى: في الإعدادات، افتح أدلة التلفزيون.');
    const two = setup();
    two.engine.stored = () => Promise.resolve(withGuides([WITHOUT_LOGINS[0]!], BARE_GUIDES));
    two.engine.settle?.resolve({ state: 'restored', language: 'en', sources: 1 });
    await flush();
    expect(stripIsolates(textOf(byTestId(draw(two.start), 'backup-guides')[0]))).toBe('2 TV guides need their links again: in Settings, open TV guides.');
  });
});

describe('createBackupStart after Settings’ "Restore it" (RELAY step 32d2b)', () => {
  function restoredSetup(profile: LoadedProfile) {
    const engine = new FakeEngine();
    const clock = manualTimers();
    const start = createBackupStart({ engine, restored: profile, timers: clock.timers, welcomeMs: WELCOME_MS });
    let end: BackupStartEnd | null = null;
    void start.done.then((value) => {
      end = value;
    });
    return { engine, clock, start, end: () => end };
  }

  it('shows "Welcome back" on the restored profile at once: no look-up, no profile read, no limit', async () => {
    const s = restoredSetup(RESTORED);
    expect(s.start.screen.value).toBe(WELCOME_SCREEN);
    expect(s.start.nav.top.id).toBe(WELCOME_SCREEN);
    expect(s.start.language.value).toBe('ar');
    expect(s.start.sources.value).toBe(2);
    expect(s.start.files.value).toBe(1);
    expect(s.engine.requests).toEqual([]);
    expect(s.engine.profileReads).toBe(0);
    expect(s.clock.due()).toEqual([WELCOME_MS]);
    s.clock.advance(WELCOME_MS);
    await flush();
    expect(s.end()).toEqual({ profile: RESTORED, restored: true, toSources: false, toGuides: false });
  });

  it('ends early on OK, as after a look-up', async () => {
    const s = restoredSetup(RESTORED);
    s.start.nav.handle('OK');
    await flush();
    expect(s.end()).toEqual({ profile: RESTORED, restored: true, toSources: false, toGuides: false });
    expect(s.clock.due()).toEqual([]);
  });

  it('ends at once on a profile with no source (onboarding)', async () => {
    const empty = profileWith([]);
    const s = restoredSetup(empty);
    await flush();
    expect(s.end()).toEqual({ profile: empty, restored: false, toSources: false, toGuides: false });
    expect(s.start.screen.value).toBe(LOOKING_SCREEN);
  });
});
