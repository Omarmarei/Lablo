import type { VNode } from 'preact';
import type { EpgProgramme } from '@lablo/core';
import type { ProgrammeRequest } from '@lablo/data';
import type { Intent } from '@lablo/platform-api';
import { bindFocus, createNavigator } from '@lablo/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DetailsShown, DetailsTarget } from './programme-details';
import { DETAILS_ACTIONS, DETAILS_SCREEN, createDetails, detailsActions } from './programme-details';
import { appI18n } from '../i18n';
import { ProgrammeDialog, detailsLines } from './ProgrammeDialog';

const target = (start: number, title = `At ${start}`): DetailsTarget => ({ key: 'x:s1:live:0-1', channel: { number: 2, name: 'Channel 1' }, start, end: start + 30, title });
/** A programme in the channel's archive (step 25a). */
const archived = (start: number): DetailsTarget => ({ ...target(start), archive: true });
/** The buttons of a dialog without "Watch from the start". */
const DETAILS_WATCH = 0;
const DETAILS_MAP = 1;
const DETAILS_CLOSE = 2;
const programme = (start: number, desc = `About ${start}`): EpgProgramme => ({ start, end: start + 30, title: `At ${start}`, sub: ' Part one ', desc, category: 'News', episode: 'S1 E2', flags: 0 });

interface Held {
  readonly req: ProgrammeRequest;
  resolve(p: EpgProgramme | null): void;
  reject(error: unknown): void;
}

function setup() {
  const held: Held[] = [];
  const engine = {
    programme: (req: ProgrammeRequest): Promise<EpgProgramme | null> => new Promise((resolve, reject) => held.push({ req, resolve, reject })),
  };
  const nav = createNavigator({
    root: { id: 'guide', zones: [{ kind: 'list', id: 'grid', axis: 'vertical', count: 10 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
    now: () => 0,
  });
  const watch = vi.fn();
  const map = vi.fn();
  const fromStart = vi.fn();
  let tracked = 0;
  const details = createDetails({
    nav,
    engine,
    watch,
    map,
    fromStart,
    track: (request) => {
      tracked += 1;
      return request();
    },
  });
  const press = async (...keys: Intent[]): Promise<void> => {
    for (const key of keys) nav.handle(key);
    await Promise.resolve();
  };
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  return { held, nav, watch, map, fromStart, details, press, at, tracked: () => tracked };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the programme details (RELAY step 24a)', () => {
  it('opens over the guide on "Watch the channel" with what the grid has, and reads the rest', async () => {
    const t = setup();
    t.details.open(target(600));
    expect(t.at()).toBe(`${DETAILS_SCREEN} · ${DETAILS_ACTIONS} ${DETAILS_WATCH}`);
    expect(t.nav.top.zone(DETAILS_ACTIONS)).toMatchObject({ kind: 'list', axis: 'horizontal', count: 3 });
    expect(detailsActions(false)).toEqual(['watch', 'map', 'close']);
    expect(t.details.shown.value).toEqual({ target: target(600), status: 'reading', programme: null });
    expect(t.held.map((h) => h.req)).toEqual([{ key: 'x:s1:live:0-1', start: 600 }]);
    expect(t.tracked()).toBe(1);
    t.held[0]!.resolve(programme(600));
    await settle();
    expect(t.details.shown.value).toEqual({ target: target(600), status: 'read', programme: programme(600) });
    // A second open while it shows does nothing.
    t.details.open(target(900));
    expect(t.held).toHaveLength(1);
    expect(t.details.shown.value?.target.start).toBe(600);
  });

  it('shows a read that found nothing, and a failed read', async () => {
    const t = setup();
    t.details.open(target(600));
    t.held[0]!.resolve(null);
    await settle();
    expect(t.details.shown.value).toMatchObject({ status: 'read', programme: null });
    await t.press('BACK');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    t.details.open(target(630));
    t.held[1]!.reject(new Error('gone'));
    await settle();
    expect(t.details.shown.value).toEqual({ target: target(630), status: 'failed', programme: null });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('closes on Back and on "Close", and plays from "Watch the channel" once it has closed', async () => {
    const t = setup();
    t.details.open(target(600));
    await t.press('BACK');
    expect(t.at()).toBe('guide · grid 0');
    expect(t.details.shown.value).toBeNull();
    t.details.open(target(600));
    await t.press('RIGHT', 'RIGHT');
    expect(t.at()).toBe(`${DETAILS_SCREEN} · ${DETAILS_ACTIONS} ${DETAILS_CLOSE}`);
    await t.press('OK');
    expect(t.at()).toBe('guide · grid 0');
    expect(t.watch).not.toHaveBeenCalled();
    expect(t.map).not.toHaveBeenCalled();
    t.details.open(target(660));
    let top = '';
    let shown: DetailsShown | null | undefined;
    t.watch.mockImplementation(() => {
      top = t.nav.top.id;
      shown = t.details.shown.value;
    });
    await t.press('OK');
    expect(t.watch).toHaveBeenCalledWith(target(660));
    expect([top, shown]).toEqual(['guide', null]);
    expect(t.map).not.toHaveBeenCalled();
    // Other keys are the dialog's own: they don't reach the guide.
    t.details.open(target(690));
    await t.press('DOWN', 'UP');
    expect(t.at()).toBe(`${DETAILS_SCREEN} · ${DETAILS_ACTIONS} ${DETAILS_WATCH}`);
  });

  it('hands the programme to "Guide channel" once it has closed (step 24e), and to nothing without one', async () => {
    const t = setup();
    t.details.open(target(600));
    let top = '';
    let shown: DetailsShown | null | undefined;
    t.map.mockImplementation(() => {
      top = t.nav.top.id;
      shown = t.details.shown.value;
    });
    await t.press('RIGHT');
    expect(t.at()).toBe(`${DETAILS_SCREEN} · ${DETAILS_ACTIONS} ${DETAILS_MAP}`);
    await t.press('OK');
    expect(t.map).toHaveBeenCalledTimes(1);
    expect(t.map).toHaveBeenCalledWith(target(600));
    expect([top, shown]).toEqual(['guide', null]);
    expect(t.watch).not.toHaveBeenCalled();
    // A dialog with no `map` closes on it all the same.
    const nav = createNavigator({ root: { id: 'guide', zones: [{ kind: 'list', id: 'grid', axis: 'vertical', count: 1 }] }, rootBack: 'exit-dialog', exit: () => undefined, exitDialog: () => undefined, now: () => 0 });
    const watch = vi.fn();
    const bare = createDetails({ nav, engine: { programme: () => Promise.resolve(null) }, watch });
    bare.open(target(1));
    nav.handle('RIGHT');
    nav.handle('OK');
    expect(nav.top.id).toBe('guide');
    expect(bare.shown.value).toBeNull();
    expect(watch).not.toHaveBeenCalled();
  });

  it('drops an answer for a dialog that closed, or that opened again since', async () => {
    const t = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    t.details.open(target(600));
    await t.press('BACK');
    t.held[0]!.resolve(programme(600));
    await settle();
    expect(t.details.shown.value).toBeNull();
    // Opened again on another programme while the first read is out.
    t.details.open(target(700));
    await t.press('BACK');
    t.details.open(target(800));
    t.held[1]!.reject(new Error('late'));
    t.held[2]!.resolve(programme(800));
    await settle();
    expect(t.details.shown.value).toEqual({ target: target(800), status: 'read', programme: programme(800) });
    expect(warn).not.toHaveBeenCalled();
    // After dispose, nothing changes.
    await t.press('BACK');
    t.details.open(target(900));
    t.details.dispose();
    t.held[3]!.reject(new Error('disposed'));
    await settle();
    expect(t.details.shown.value?.status).toBe('reading');
    expect(warn).not.toHaveBeenCalled();
  });

  it('runs its read untracked when no tracker is given', async () => {
    const nav = createNavigator({ root: { id: 'guide', zones: [{ kind: 'list', id: 'grid', axis: 'vertical', count: 1 }] }, rootBack: 'exit-dialog', exit: () => undefined, exitDialog: () => undefined, now: () => 0 });
    const details = createDetails({ nav, engine: { programme: () => Promise.resolve(programme(1)) }, watch: () => undefined });
    details.open(target(1));
    await settle();
    expect(details.shown.value).toMatchObject({ status: 'read', programme: programme(1) });
  });
});

describe('"Watch from the start" in the details (RELAY step 25a)', () => {
  it('comes first, focused, for a programme in the archive, and hands it over once the dialog has closed', async () => {
    expect(detailsActions(true)).toEqual(['archive', 'watch', 'map', 'close']);
    const t = setup();
    t.details.open(archived(600));
    expect(t.at()).toBe(`${DETAILS_SCREEN} · ${DETAILS_ACTIONS} 0`);
    expect(t.nav.top.zone(DETAILS_ACTIONS)).toMatchObject({ kind: 'list', axis: 'horizontal', count: 4 });
    let top = '';
    let shown: DetailsShown | null | undefined;
    t.fromStart.mockImplementation(() => {
      top = t.nav.top.id;
      shown = t.details.shown.value;
    });
    await t.press('OK');
    expect(t.fromStart).toHaveBeenCalledTimes(1);
    expect(t.fromStart).toHaveBeenCalledWith(archived(600));
    expect([top, shown]).toEqual(['guide', null]);
    expect(t.watch).not.toHaveBeenCalled();
    expect(t.map).not.toHaveBeenCalled();
  });

  it('moves the other buttons one on: "Watch the channel", "Guide channel" and "Close"', async () => {
    const t = setup();
    t.details.open(archived(600));
    await t.press('RIGHT', 'OK');
    expect(t.watch).toHaveBeenCalledWith(archived(600));
    t.details.open(archived(630));
    await t.press('RIGHT', 'RIGHT', 'OK');
    expect(t.map).toHaveBeenCalledWith(archived(630));
    t.details.open(archived(660));
    await t.press('RIGHT', 'RIGHT', 'RIGHT');
    expect(t.at()).toBe(`${DETAILS_SCREEN} · ${DETAILS_ACTIONS} 3`);
    await t.press('OK');
    expect(t.at()).toBe('guide · grid 0');
    expect([t.watch.mock.calls.length, t.map.mock.calls.length, t.fromStart.mock.calls.length]).toEqual([1, 1, 0]);
    // A target that says it isn't in the archive gets the three buttons.
    t.details.open({ ...target(690), archive: false });
    expect(t.nav.top.zone(DETAILS_ACTIONS)).toMatchObject({ count: 3 });
    await t.press('OK');
    expect(t.watch).toHaveBeenCalledTimes(2);
    expect(t.fromStart).not.toHaveBeenCalled();
  });

  it('closes on it all the same without a `fromStart`', () => {
    const nav = createNavigator({ root: { id: 'guide', zones: [{ kind: 'list', id: 'grid', axis: 'vertical', count: 1 }] }, rootBack: 'exit-dialog', exit: () => undefined, exitDialog: () => undefined, now: () => 0 });
    const watch = vi.fn();
    const bare = createDetails({ nav, engine: { programme: () => Promise.resolve(null) }, watch });
    bare.open(archived(1));
    nav.handle('OK');
    expect(nav.top.id).toBe('guide');
    expect(bare.shown.value).toBeNull();
    expect(watch).not.toHaveBeenCalled();
  });
});

describe('the details’ lines', () => {
  it('are the read programme’s texts, trimmed, and empty before it is read', () => {
    expect(detailsLines({ target: target(1), status: 'reading', programme: null })).toEqual({ sub: '', category: '', episode: '', desc: '' });
    expect(detailsLines({ target: target(1), status: 'read', programme: { ...programme(1, '  Two lines\nof text \n'), category: ' ', episode: ' E5 ' } })).toEqual({
      sub: 'Part one',
      category: '',
      episode: 'E5',
      desc: 'Two lines\nof text',
    });
  });
});

describe('the details dialog as drawn', () => {
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
  const byClass = (root: unknown, cls: string): VNode[] => walk(root).filter((v) => String((v.props as Props).class ?? '').split(' ').indexOf(cls) !== -1);
  const textOf = (v: VNode | undefined): string => walk(v)
    .flatMap((n) => {
      const c = (n.props as Props).children;
      return (Array.isArray(c) ? c : [c]).filter((x): x is string | number => typeof x === 'string' || typeof x === 'number');
    })
    .join('');

  /** The dialog drawn over a real navigator, at `status` with `p` read. */
  async function draw(p: EpgProgramme | null, status: 'read' | 'failed' | 'reading', locale = 'en-US') {
    const t = setup();
    t.details.open(target(600, 'Evening News'));
    if (status === 'read') t.held[0]!.resolve(p);
    if (status === 'failed') {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      t.held[0]!.reject(new Error('x'));
    }
    await settle();
    const i18n = appI18n(locale, { isolate: false });
    const dialog = ProgrammeDialog({ details: t.details, i18n, binding: bindFocus(t.nav) })!;
    return { dialog, props: dialog.props as Props & { body: unknown } };
  }

  it('draws the grid’s title, channel and times, the read programme’s lines, and the buttons', async () => {
    const { props } = await draw(programme(600), 'read');
    expect(props).toMatchObject({ title: 'Evening News', data: true, wide: true, testId: 'programme' });
    const body = props.body;
    expect(textOf(byClass(body, 'details__channel')[0])).toBe('2Channel 1');
    expect(byClass(body, 'details__name')[0]!.props).toMatchObject({ dir: 'auto', translate: false });
    expect(textOf(byClass(body, 'details__sub')[0])).toBe('Part one');
    expect(byClass(body, 'details__sub')[0]!.props).toMatchObject({ dir: 'auto', translate: false });
    expect(textOf(byClass(body, 'details__length')[0])).toBe('30 minutes');
    expect(byClass(body, 'details__length')[0]!.props).toMatchObject({ 'data-n': 30 });
    expect(byClass(body, 'details__tag').map(textOf)).toEqual(['News', 'S1 E2']);
    expect(byClass(body, 'details__tag').every((v) => (v.props as Props).dir === 'auto' && (v.props as Props).translate === false)).toBe(true);
    expect(textOf(byClass(body, 'details__desc')[0])).toBe('About 600');
    expect(byClass(body, 'details__desc')[0]!.props).toMatchObject({ dir: 'auto', translate: false });
    expect(byClass(body, 'details__note')).toEqual([]);
    expect(byClass(body, 'details__reading')).toEqual([]);
    const buttons = walk(props.children).filter((v) => typeof v.type === 'function');
    expect(buttons.map((b) => [(b.props as Props).label, (b.props as Props).testId, (b.props as Props).variant])).toEqual([
      ['Watch the channel', 'programme-watch', 'primary'],
      ['Guide channel', 'programme-map', 'secondary'],
      ['Close', 'programme-close', 'secondary'],
    ]);
  });

  it('draws "Watch from the start" first, as the primary, for a programme in the archive (step 25a)', () => {
    const t = setup();
    t.details.open(archived(600));
    const draw = (locale: string) => {
      const dialog = ProgrammeDialog({ details: t.details, i18n: appI18n(locale, { isolate: false }), binding: bindFocus(t.nav) })!;
      return walk((dialog.props as Props).children).filter((v) => typeof v.type === 'function').map((b) => [(b.props as Props).label, (b.props as Props).testId, (b.props as Props).variant, (b.props as Props).state]);
    };
    expect(draw('en-US')).toEqual([
      ['From the start', 'programme-archive', 'primary', 'focused'],
      ['Watch the channel', 'programme-watch', 'secondary', 'idle'],
      ['Guide channel', 'programme-map', 'secondary', 'idle'],
      ['Close', 'programme-close', 'secondary', 'idle'],
    ]);
    expect(draw('ar-SA').map((b) => b[0])).toEqual(['من البداية', 'شاهد القناة', 'قناة الدليل', 'إغلاق']);
  });

  it('says how many days a programme in the archive has left (step 25c), and nothing without them', () => {
    const left = (shown: DetailsTarget, locale = 'en-US'): Array<[string, unknown]> => {
      const t = setup();
      t.details.open(shown);
      const dialog = ProgrammeDialog({ details: t.details, i18n: appI18n(locale, { isolate: false }), binding: bindFocus(t.nav) })!;
      return byClass((dialog.props as Props & { body: unknown }).body, 'details__left').map((v) => [textOf(v), (v.props as Props)['data-days']]);
    };
    expect(left({ ...archived(600), daysLeft: 6 })).toEqual([['Expires in 6 days', 6]]);
    expect(left({ ...archived(600), daysLeft: 1 })).toEqual([['Expires in 1 day', 1]]);
    expect(left({ ...archived(600), daysLeft: 0 })).toEqual([['Expires today', 0]]);
    expect(left({ ...archived(600), daysLeft: 6 }, 'ar-SA')).toEqual([['ينتهي خلال 6 أيام', 6]]);
    expect(left({ ...archived(600), daysLeft: 0 }, 'ar-SA')).toEqual([['ينتهي اليوم', 0]]);
    // A channel that states no days, and a programme not in the archive.
    expect(left(archived(600))).toEqual([]);
    expect(left({ ...target(600), daysLeft: 3 })).toEqual([]);
  });

  it('leaves out the lines the guide doesn’t have, and says so for the description', async () => {
    const { props } = await draw({ ...programme(600, ' '), sub: '', category: '', episode: '' }, 'read');
    expect(byClass(props.body, 'details__sub')).toEqual([]);
    expect(byClass(props.body, 'details__tags')).toEqual([]);
    expect(byClass(props.body, 'details__desc')).toEqual([]);
    expect(byClass(props.body, 'details__note').map(textOf)).toEqual(['No description']);
    // Only an episode: one tag.
    const one = await draw({ ...programme(600), category: '' }, 'read');
    expect(byClass(one.props.body, 'details__tag').map(textOf)).toEqual(['S1 E2']);
  });

  it('shows a spinner while it reads, and a note when the read failed', async () => {
    const reading = await draw(null, 'reading');
    expect(byClass(reading.props.body, 'details__reading')).toHaveLength(1);
    expect(byClass(reading.props.body, 'details__note')).toEqual([]);
    const failed = await draw(null, 'failed', 'ar-SA');
    expect(byClass(failed.props.body, 'details__reading')).toEqual([]);
    expect(byClass(failed.props.body, 'details__note').map(textOf)).toEqual(['تعذّرت قراءة التفاصيل.']);
    // A read that found nothing says there is no description.
    const none = await draw(null, 'read');
    expect(byClass(none.props.body, 'details__note').map(textOf)).toEqual(['No description']);
  });

  it('titles a programme with no title with our words, and draws nothing once closed', async () => {
    const t = setup();
    t.details.open(target(600, ''));
    const i18n = appI18n('en-US', { isolate: false });
    const binding = bindFocus(t.nav);
    expect((ProgrammeDialog({ details: t.details, i18n, binding })!.props as Props)).toMatchObject({ title: 'No information', data: false });
    await t.press('BACK');
    expect(ProgrammeDialog({ details: t.details, i18n, binding })).toBeNull();
  });
});
