// RELAY step 13c: the old-engine harness walks onboarding with its own ES5 probe and constants
// (tools/* may not import the app or @zoma/data). This keeps them equal to the app's, to the
// data layer's and to the e2e test's.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readScreen } from '../apps/tv/src/data/params';
import { FORM_FIELDS, checkForm } from '../apps/tv/src/onboarding/form';
import { DB_NAME, STORE } from '../packages/data/src/schema';
import { dataChecks, fixtureEntries } from '../tools/engines/src/fixture';
import { APP_DATABASE, LAYOUT_BOXES, LAYOUT_LABELS, PLAYLIST_INPUT, SOURCE_NAME, onboardingUrl, playlistLink } from '../tools/engines/src/onboarding';
import { WALK_SEEDS } from '../tools/engines/src/variants';

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
