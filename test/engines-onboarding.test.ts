// RELAY steps 13c, 14a and 14c: the old-engine harness walks onboarding to the live screen, and
// the live screen by keys, with its own ES5 probe and constants (tools/* may not import the app,
// @zoma/ui or @zoma/data). This keeps them equal to the app's, to the data layer's, to the TV
// adapters' and to the e2e tests'.

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
import { dataChecks, fixtureEntries } from '../tools/engines/src/fixture';
import { CHANNELS_VISIBLE, LIVE_BOXES, LIVE_LABELS, LIVE_TEXT, LIVE_VIEW_FUNCTION, PLATFORM_BACK_STUB, TV_KEYS } from '../tools/engines/src/live';
import { APP_DATABASE, LAYOUT_BOXES, LAYOUT_LABELS, PLAYLIST_INPUT, SOURCE_NAME, WALK_EXPRESSION, onboardingUrl, playlistLink, walkSteps } from '../tools/engines/src/onboarding';
import { CSS_SEEDS, WALK_SEEDS, seedCss } from '../tools/engines/src/variants';

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
