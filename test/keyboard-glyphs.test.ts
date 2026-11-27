import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AR } from '../apps/tv/src/i18n/ar';
import { EN } from '../apps/tv/src/i18n/en';
import type { KeyboardKind, LayoutName } from '../packages/ui/src/focus/keyboard-layouts';
import { layoutRows } from '../packages/ui/src/focus/keyboard-layouts';
import type { KeyboardLabels } from '../packages/ui/src/focus/screen-keyboard';
import { KEY_ICONS, keyFace } from '../packages/ui/src/focus/screen-keyboard';
import { inspectFont, toTrueType } from '../tools/fonts/src/inspect';

/**
 * RELAY step 58b: the app's own keyboard shows nothing a TV must find in its own fonts. On the LG
 * the delete key's ⌫ (not in Lablo Sans) drew an empty box; Shift, Delete and the TV keyboard's
 * key are icons now. Every character any key shows, on every page, in both languages, is in the
 * regular faces' character maps (the keys are not bold).
 */
const FONTS = path.resolve(import.meta.dirname, '../packages/ui/assets/fonts');

async function regularCharacters(): Promise<Set<number>> {
  const all = new Set<number>();
  for (const file of ['lablo-latin-400.woff2', 'lablo-arabic-400.woff2']) {
    const face = inspectFont(await toTrueType(readFileSync(path.join(FONTS, file))));
    face.codePoints.forEach((c) => all.add(c));
  }
  return all;
}

function labels(words: Record<string, string>): KeyboardLabels {
  const t = (key: string): string => words[key] ?? '';
  return {
    title: t('keyboard.title'),
    done: t('keyboard.done'),
    native: t('keyboard.native'),
    space: t('keyboard.space'),
    delete: t('keyboard.delete'),
    shift: t('keyboard.shift'),
    symbols: t('keyboard.symbols'),
    letters: t('keyboard.letters'),
    arabic: t('keyboard.arabic'),
    latin: t('keyboard.latin'),
  };
}

const LAYOUTS: readonly LayoutName[] = ['latin', 'arabic', 'symbols', 'digits'];
const KINDS: readonly KeyboardKind[] = ['text', 'url', 'password', 'tel'];

describe('the own keyboard keys and the bundled font (step 58b)', () => {
  it('every character a key shows is in Lablo Sans, on every page, in English and Arabic', async () => {
    const font = await regularCharacters();
    const missing = new Set<string>();
    let shown = 0;
    for (const words of [EN, AR] as Array<Record<string, string>>) {
      const said = labels(words);
      expect(said.done).not.toBe('');
      for (const layout of LAYOUTS)
        for (const kind of KINDS)
          for (const shifted of [false, true])
            for (const row of layoutRows(layout, kind, shifted))
              for (const key of row) {
                const face = keyFace(key, said, layout, shifted);
                for (const c of face) {
                  shown += 1;
                  if (!font.has(c.codePointAt(0)!)) missing.add(`${c} U+${c.codePointAt(0)!.toString(16).toUpperCase()} (${layout})`);
                }
              }
    }
    expect([...missing]).toEqual([]);
    expect(shown).toBeGreaterThan(1000);
  });

  it('the icons stand for the three characters the font lacks', async () => {
    const font = await regularCharacters();
    expect(Object.keys(KEY_ICONS).sort()).toEqual(['delete', 'native', 'shift']);
    // U+21E7 U+232B U+2328: Shift, Delete and a keyboard.
    for (const code of [0x21e7, 0x232b, 0x2328]) expect(font.has(code)).toBe(false);
  });
});
