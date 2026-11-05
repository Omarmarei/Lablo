import type { VNode } from 'preact';
import type { EpgProgramme } from '@zoma/core';
import type { ProgrammeRequest } from '@zoma/data';
import type { Intent } from '@zoma/platform-api';
import { bindFocus, createNavigator } from '@zoma/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DetailsShown, DetailsTarget } from './programme-details';
import { DETAILS_ACTIONS, DETAILS_CLOSE, DETAILS_SCREEN, DETAILS_WATCH, createDetails } from './programme-details';
import { appI18n } from '../i18n';
import { ProgrammeDialog, detailsLines } from './ProgrammeDialog';

const target = (start: number, title = `At ${start}`): DetailsTarget => ({ key: 'x:s1:live:0-1', channel: { number: 2, name: 'Channel 1' }, start, end: start + 30, title });
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
  let tracked = 0;
  const details = createDetails({
    nav,
    engine,
    watch,
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
  return { held, nav, watch, details, press, at, tracked: () => tracked };
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
    expect(t.nav.top.zone(DETAILS_ACTIONS)).toMatchObject({ kind: 'list', axis: 'horizontal', count: 2 });
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
    await t.press('RIGHT');
    expect(t.at()).toBe(`${DETAILS_SCREEN} · ${DETAILS_ACTIONS} ${DETAILS_CLOSE}`);
    await t.press('OK');
    expect(t.at()).toBe('guide · grid 0');
    expect(t.watch).not.toHaveBeenCalled();
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
    // Other keys are the dialog's own: they don't reach the guide.
    t.details.open(target(690));
    await t.press('DOWN', 'UP');
    expect(t.at()).toBe(`${DETAILS_SCREEN} · ${DETAILS_ACTIONS} ${DETAILS_WATCH}`);
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
      ['Close', 'programme-close', undefined],
    ]);
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
