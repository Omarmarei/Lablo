// RELAY steps 13c, 14a, 14c and 23e: the old-engine harness walks onboarding to the live screen,
// the live screen by keys and the grid guide, with its own ES5 probes and constants (tools/* may
// not import the app, @zoma/ui or @zoma/data). This keeps them equal to the app's, to the data
// layer's, to the TV adapters' and to the e2e tests'.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readScreen } from '../apps/tv/src/data/params';
import { AR } from '../apps/tv/src/i18n/ar';
import { EN } from '../apps/tv/src/i18n/en';
import { FORM_FIELDS, checkForm } from '../apps/tv/src/onboarding/form';
import { DB_NAME, STORE } from '../packages/data/src/schema';
import { buildTizenKeyMap } from '../packages/platform-tizen/src/keys';
import { webosKeyToIntent } from '../packages/platform-webos/src/index';
import { GUIDE_LAYOUT, guideFits, guideWidth } from '../packages/ui/src/components/guide-layout';
import { buildCss } from '../tools/build/src/css';
import { dataChecks, fixtureEntries } from '../tools/engines/src/fixture';
import { SAFE_AREA, VIEWPORT } from '../tools/engines/src/gallery';
import {
  GRID_VIEW_FUNCTION,
  GUIDE_BOXES,
  GUIDE_HEADER,
  GUIDE_LABELS,
  GUIDE_ROWS,
  GUIDE_SLOT,
  GUIDE_SPAN,
  GUIDE_TEXT,
  GUIDE_LAYOUT as HARNESS_LAYOUT,
  guideWidth as harnessWidth,
} from '../tools/engines/src/guide';
import { CHANNELS_VISIBLE, LIVE_BOXES, LIVE_LABELS, LIVE_TEXT, LIVE_VIEW_FUNCTION, PLATFORM_BACK_STUB, TV_KEYS } from '../tools/engines/src/live';
import { APP_DATABASE, LAYOUT_BOXES, LAYOUT_LABELS, PLAYLIST_INPUT, SOURCE_NAME, WALK_EXPRESSION, guideSteps, onboardingUrl, playlistLink, walkSteps } from '../tools/engines/src/onboarding';
import { CSS_SEEDS, GUIDE_CELL_X, WALK_SEEDS, seedCss } from '../tools/engines/src/variants';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

describe('the onboarding walk of the old-engine harness', () => {
  it('opens the start screen, as a TV does', () => {
    expect(readScreen(new URL(onboardingUrl('app', 'webos')).search)).toBe('onboarding');
  });

  it("reads and deletes the app's own database, profile store and profile key", () => {
    expect(APP_DATABASE.name).toBe(DB_NAME);
    expect(APP_DATABASE.profileStore).toBe(STORE.profile);
    expect(read('packages/data/src/profile.ts')).toContain(`const CURRENT = '${APP_DATABASE.profileKey}';`);
    // The seed that forgets the profile deletes the same database.
    expect(WALK_SEEDS.find((seed) => seed.id === 'seed-walk-forgets-profile')?.code).toBe(`indexedDB.deleteDatabase('${DB_NAME}');`);
  });

  it("types into the M3U form's first field, by the id the text editor finds its input by", () => {
    expect(FORM_FIELDS.m3u[0]?.id).toBe('playlist');
    expect(read('apps/tv/src/onboarding/onboarding-state.ts')).toContain('return `onboarding-${id}`;');
    expect(PLAYLIST_INPUT).toBe('onboarding-playlist');
  });

  it('types a link the form accepts without http://, and names the source after its host', () => {
    for (const check of Object.values(dataChecks(fixtureEntries()))) {
      const link = playlistLink(check);
      expect(link).not.toMatch(/^https?:/);
      const { problems, draft } = checkForm('m3u', { playlist: link });
      expect(problems).toEqual({});
      expect(draft).toMatchObject({ type: 'm3u', url: `http://${link}`, name: SOURCE_NAME, epgUrl: null });
    }
  });

  it('ends on the live screen by the marks the live screen writes (RELAY step 14a)', () => {
    const app = read('apps/tv/src/live/LiveApp.tsx');
    // Ready: the channels show. Idle: no data request in flight, so leaving the page can't stall a database delete.
    expect(app).toContain('data-testid="live"');
    expect(app).toContain('data-status={status}');
    expect(app).toContain('data-pending={live.pending.value}');
    expect(app).toContain('data-testid="live-meta"');
    expect(app).toContain('<span data-n={entry.count}>');
    expect(WALK_EXPRESSION).toContain(`document.querySelector('[data-testid="live"]')`);
    expect(WALK_EXPRESSION).toContain(`live.getAttribute('data-status') === 'ready' && live.getAttribute('data-pending') === '0'`);
    expect(WALK_EXPRESSION).toContain(`live.querySelector('[data-testid="live-meta"] [data-n]')`);
    // The walk expects the screen, zone and first channel the live screen starts on.
    expect(read('apps/tv/src/live/live-state.ts')).toContain("id: 'live',");
    expect(read('apps/tv/src/live/live-state.ts')).toContain("initial: 'channels',");
    expect(walkSteps('en', 'x', 'tizen').find((s) => s.id === 'relaunch')?.expect).toMatchObject({ screen: 'live', zone: 'channels', index: 0 });
  });

  it('measures the boxes and labels of e2e/onboarding.spec.ts', () => {
    const spec = read('e2e/onboarding.spec.ts');
    for (const [name, selectors] of [
      ['boxes', LAYOUT_BOXES],
      ['labels', LAYOUT_LABELS],
    ] as const) {
      expect(new RegExp(`const ${name} = '([^']+)';`).exec(spec)?.[1], `const ${name} in e2e/onboarding.spec.ts`).toBe(selectors);
    }
  });
});

describe('the live screen of the old-engine harness (RELAY step 14c)', () => {
  it('measures the boxes and labels of e2e/live.spec.ts, and pages by the window it checks', () => {
    const spec = read('e2e/live.spec.ts');
    for (const [name, selectors] of [
      ['boxes', LIVE_BOXES],
      ['labels', LIVE_LABELS],
    ] as const) {
      expect(new RegExp(`const ${name} = '([^']+)';`).exec(spec)?.[1], `const ${name} in e2e/live.spec.ts`).toBe(selectors);
    }
    expect(spec).toContain(`const VISIBLE = ${CHANNELS_VISIBLE};`);
    expect(read('apps/tv/src/live/live-state.ts')).toContain('export const CHANNELS_VISIBLE = fits(LIVE_BODY, LAYOUT.rowHeight, LIVE.rowGap);');
  });

  it('expects our own words as the catalogs have them', () => {
    expect(LIVE_TEXT.en).toEqual({ all: EN['category.all'], noGuide: EN['guide.none'] });
    expect(LIVE_TEXT.ar).toEqual({ all: AR['category.all'], noGuide: AR['guide.none'] });
  });

  it('presses the key codes the TV adapters read as CH+, CH− and Back', () => {
    const tizen = buildTizenKeyMap(null);
    expect([TV_KEYS.tizen.chUp, TV_KEYS.tizen.chDown, TV_KEYS.tizen.back].map((k) => tizen.get(k.keyCode))).toEqual(['CH_UP', 'CH_DOWN', 'BACK']);
    expect([TV_KEYS.webos.chUp, TV_KEYS.webos.chDown, TV_KEYS.webos.back].map((k) => webosKeyToIntent(k))).toEqual(['CH_UP', 'CH_DOWN', 'BACK']);
    // The seed that keeps Back from the app keeps exactly these.
    expect(WALK_SEEDS.find((s) => s.id === 'seed-live-no-back-key')?.code).toContain(
      `event.keyCode === ${TV_KEYS.tizen.back.keyCode} || event.keyCode === ${TV_KEYS.webos.back.keyCode}`,
    );
  });

  it('reads the marks the live screen, its virtual lists, rows and chips draw', () => {
    const marks: Array<[string, string[]]> = [
      ['apps/tv/src/live/LiveApp.tsx', ['data-category={shown}', 'testId="rail"', 'testId="channels"', '<span class="live__category"', 'testId="exit-dialog"']],
      ['packages/ui/src/components/VirtualList.tsx', ['<div key={i} class="z-vlist__item" data-index={i}', 'data-top={from}']],
      ['packages/ui/src/components/ListRow.tsx', ['<span class="z-row__number">', '<span class="z-row__name"', '<div class="z-row__now">', '<span class="z-row__title"', '<div class="z-row__next">']],
      ['packages/ui/src/components/Chip.tsx', ["selected ? ' is-selected' : ''", '<span class="z-chip__label"', '<span class="z-chip__count">']],
      ['packages/ui/src/components/Dialog.tsx', ['data-testid={testId}']],
      ['apps/tv/src/test-hook.ts', ['target.__ZOMA_TEST__ = {', 'focusPath: () =>']],
    ];
    for (const [file, wanted] of marks) {
      const source = read(file);
      for (const mark of wanted) expect(source, `${file}: ${mark}`).toContain(mark);
    }
    expect(LIVE_VIEW_FUNCTION).toContain('.z-row__now .z-row__title');
    expect(WALK_EXPRESSION).toContain('hook.focusPath()');
  });

  it("leaves webOS through PalmSystem.platformBack(), read when Back is pressed, and Tizen through its exit dialog", () => {
    const webos = read('packages/platform-webos/src/index.ts');
    expect(webos).toContain("rootBackPolicy: () => 'platform-back',");
    expect(webos).toContain('const palm = palmSystem();');
    expect(webos).toContain('if (palm?.platformBack !== undefined) palm.platformBack();');
    expect(PLATFORM_BACK_STUB).toContain('window.PalmSystem = { platformBack:');
    expect(read('packages/platform-tizen/src/index.ts')).toContain("rootBackPolicy: () => 'exit-dialog',");
  });

  it("takes live.css's rules out with the CSS seed, so a renamed class can't leave it a no-op", () => {
    const seed = CSS_SEEDS.find((s) => s.id === 'seed-css-no-live')!;
    const css = read('apps/tv/src/live/live.css');
    const result = seed.edit(css);
    expect(result.removed).toBeGreaterThanOrEqual(10);
    expect(seedCss(css, seed)).not.toMatch(/\.live(__|[^\w-])/);
  });
});

describe('the grid guide of the old-engine harness (RELAY step 23e)', () => {
  it("measures against packages/ui's GUIDE_LAYOUT and the guide screen's sizes", () => {
    expect(HARNESS_LAYOUT).toEqual(GUIDE_LAYOUT);
    for (const span of [60, GUIDE_SPAN, 180]) expect(harnessWidth(span)).toBe(guideWidth(span));
    const state = read('apps/tv/src/guide/guide-state.ts');
    for (const mark of [`headerHeight: ${GUIDE_HEADER},`, `span: ${GUIDE_SPAN},`, `slot: ${GUIDE_SLOT},`, 'export const GUIDE_VISIBLE = guideFits(SCREEN.height - 2 * SCREEN.safeY - GUIDE.headerHeight);']) {
      expect(state, mark).toContain(mark);
    }
    expect(guideFits(VIEWPORT.height - 2 * SAFE_AREA.top - GUIDE_HEADER)).toBe(GUIDE_ROWS);
    // The e2e's GuideGrid reader measures the same view.
    expect(read('e2e/guide-grid.ts')).toContain(`export const SPAN = ${GUIDE_SPAN};\nexport const ROWS = ${GUIDE_ROWS};`);
    expect(read('e2e/guide.spec.ts')).toContain(`const HEADER = ${GUIDE_HEADER};`);
  });

  it("expects our own words as the catalogs have them, and opens the guide by the header's first button", () => {
    expect(GUIDE_TEXT.en).toEqual({ open: EN['guide.open'], noInfo: EN['guide.noInfo'] });
    expect(GUIDE_TEXT.ar).toEqual({ open: AR['guide.open'], noInfo: AR['guide.noInfo'] });
    expect(read('apps/tv/src/live/live-state.ts')).toContain('export const HEADER_GUIDE = 0;');
    expect(read('apps/tv/src/live/LiveApp.tsx')).toContain('<Button label={t(\'guide.open\')} {...header.item(HEADER_GUIDE)} testId="live-guide" />');
    expect(read('apps/tv/src/live/live-state.ts')).toContain("neighbours: { start: 'rail', up: 'header' }");
    expect(guideSteps('en', 'tizen').find((s) => s.id === 'guide-header')?.expect).toMatchObject({ zone: 'header', index: 0 });
  });

  it('measures the boxes and labels of the e2e test', () => {
    expect(read('e2e/guide-grid.ts')).toContain('document.querySelectorAll(`[data-testid=guide], .z-guide__row, .z-guide__cell, .z-guide__slot, .z-guide__now, ${header}`)');
    expect(read('e2e/guide.spec.ts')).toContain("return readAny(page, 'guide-screen', '.guide__header > *');");
    expect(GUIDE_BOXES).toBe('[data-testid=guide], .z-guide__row, .z-guide__cell, .z-guide__slot, .z-guide__now, .guide__header > *');
    expect(read('e2e/guide.spec.ts')).toContain(`document.querySelectorAll('${GUIDE_LABELS}')`);
  });

  it('reads the marks the guide screen and its grid draw', () => {
    const marks: Array<[string, string[]]> = [
      [
        'apps/tv/src/guide/GuideScreen.tsx',
        ['data-testid="guide-screen"', 'data-ready="true"', 'data-pending={guide.pending.value + mappingPending}', 'data-screen={focus.screen}', 'data-zone={focus.zone}', 'data-index={focus.index}', "data-time={focus.time ?? ''}", 'testId="guide"', "data-language={i18n.locale.pseudo ? 'pseudo' : i18n.locale.language}"],
      ],
      ['apps/tv/src/guide/guide-state.ts', ["export const GUIDE_SCREEN = 'guide';", "export const GUIDE_GRID = 'grid';"]],
      [
        'packages/ui/src/components/GuideGrid.tsx',
        [
          'data-testid={testId}',
          'data-top={shown.from}',
          'data-count={rows}',
          'data-view={first}',
          'data-span={span}',
          'data-row={row}',
          '<div class="z-guide__channel"',
          '<div class="z-guide__line"',
          '<span class="z-guide__number">',
          '<span class="z-guide__name"',
          'data-start={cell.start}',
          'data-end={cell.end}',
          'data-programme={p}',
          'data-state={state}',
          '<span key={minute} class="z-guide__slot" data-minute={minute}',
          '<div class="z-guide__now" data-minute={now}',
          "let cls = focusClass('z-guide__cell', state);",
        ],
      ],
    ];
    for (const [file, wanted] of marks) {
      const source = read(file);
      for (const mark of wanted) expect(source, `${file}: ${mark}`).toContain(mark);
    }
    for (const mark of ['[data-testid="guide"]', "'.z-guide__row'", "'.z-guide__cell'", "'.z-guide__slot'", "'.z-guide__now'", "'data-programme'", "'data-state'"]) expect(GRID_VIEW_FUNCTION).toContain(mark);
    expect(WALK_EXPRESSION).toContain(`var guide = document.querySelector('[data-testid="guide-screen"]');`);
    expect(WALK_EXPRESSION).toContain(`guide.getAttribute('data-pending') === '0'`);
    expect(WALK_EXPRESSION).toContain('var shown = ob || live || guide;');
  });

  it("takes the cells' left: var(--x) and its mirror out of GuideGrid.css as the TV build makes it, and nothing else", async () => {
    const built = (await buildCss([path.join(ROOT, 'packages/ui/src/components/GuideGrid.css')])).css;
    const seed = CSS_SEEDS.find((s) => s.id === 'seed-css-no-guide-x')!;
    expect(seed.edit(built).removed).toBe(2);
    const seeded = seedCss(built, seed);
    // The mirrored rules are there, and empty after the seed: nothing else positions a cell.
    for (const [selector] of GUIDE_CELL_X) {
      expect(built).toContain(`${selector} {`);
      expect(seeded).toMatch(new RegExp(`${selector.replace(/[[\]".]/g, '\\$&')} \\{\\s*\\}`));
    }
    expect(seeded).not.toMatch(/\.z-guide__cell \{[^}]*(left|right):/);
    // The slot labels and the now line keep theirs, so only the cells move.
    expect(seeded.match(/(left|right): var\(--x\)/g)?.length).toBe(4);
    expect(built.replace(/\/\*[\s\S]*?\*\//g, '').match(/(left|right): var\(--x\)/g)?.length).toBe(6);
  });
});
