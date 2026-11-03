import path from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Proves `zoma/no-hard-coded-text` in eslint.config.js (RELAY step 12b, ADR-011): seeded TSX
 * is linted as if it lived at `file`, nothing is written to disk, so `pnpm lint` on the real
 * tree stays clean while these assertions run.
 */
const ROOT = path.resolve(import.meta.dirname, '..');
const RULE = 'zoma/no-hard-coded-text';
const GALLERY = 'apps/tv/src/gallery/Seeded.tsx';

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT });
});

/** The texts the rule reports in `jsx`, wrapped in a component in `file`. */
async function hardCoded(jsx: string, file = GALLERY): Promise<string[]> {
  const code = [
    // Stand-ins for @zoma/ui's components: no import, so no file trips the package boundaries.
    'declare const Badge: (props: Record<string, unknown>) => null;',
    'declare const Button: (props: Record<string, unknown>) => null;',
    'declare const t: (key: string) => string;',
    'declare const ok: boolean;',
    'declare const name: string;',
    `export const Seeded = () => (\n  <div>\n    ${jsx}\n  </div>\n);`,
    'export { Badge, Button, t, ok, name };',
    '',
  ].join('\n');
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, file) });
  if (!result) throw new Error(`no lint result for ${file}`);
  const others = result.messages.filter((m) => m.ruleId !== RULE);
  expect(others.map((m) => `${m.ruleId ?? 'fatal'}: ${m.message}`)).toEqual([]);
  return result.messages.map((m) => /"(.*)"/.exec(m.message)?.[1] ?? m.message);
}

describe('zoma/no-hard-coded-text', () => {
  it.each([
    ['JSX text', '<p>Loading channels</p>', ['Loading channels']],
    ['a text prop', '<Button label="Play" />', ['Play']],
    ['a text prop in braces', "<Button label={'Play'} />", ['Play']],
    ['both sides of ?:', "<Button label={ok ? 'Play' : 'Pause'} />", ['Play', 'Pause']],
    ['a literal after &&', "<Button label={(ok && 'Play') || t('action.cancel')} />", ['Play']],
    ['a concatenation', "<Button label={'Play ' + name} />", ['Play']],
    ['a template literal', '<Button label={`Play ${name}`} />', ['Play']],
    ['an aria-label', '<div aria-label="Close" />', ['Close']],
    ['an HTML title', '<span title="More info">{name}</span>', ['More info']],
    ['a child expression', "<p>{'Loading'}</p>", ['Loading']],
    ['a child ?:', "<p>{ok ? 'Yes' : t('action.cancel')}</p>", ['Yes']],
    ['Arabic text too', '<p>تشغيل</p>', ['تشغيل']],
    ['data={false}, which marks nothing', '<Badge label="LIVE" data={false} />', ['LIVE']],
    ['translate="yes"', '<span translate="yes">Live now</span>', ['Live now']],
  ])('reports %s', async (_what, jsx, texts) => {
    expect(await hardCoded(jsx)).toEqual(texts);
  });

  it.each([
    ['text from the catalogs', "<Button label={t('action.play')} />"],
    ['a catalog call inside a template', "<p>{`${t('gallery.title')} / ${name}`}</p>"],
    ['the provider’s text under translate={false}', '<span translate={false}>Zoma Sports 1 <b>HD</b></span>'],
    ['translate="no"', '<span translate="no">MBC 1</span>'],
    ['a technical mark with data', '<Badge label="HD" tone="outline" data />'],
    ['data={true}', '<Badge label="5.1" data={true} />'],
    ['punctuation and digits', "<p>{' · '}240 / 7200 (35%)</p>"],
    ['non-text props', '<Button label={name} variant="primary" testId="action-0" />'],
    ['class names and ids', '<div class="gallery__title" id="boot-error" data-testid="gallery" />'],
  ])('allows %s', async (_what, jsx) => {
    expect(await hardCoded(jsx)).toEqual([]);
  });

  it('checks the components in packages/ui, the TV app and other apps', async () => {
    for (const file of ['packages/ui/src/components/Seeded.tsx', 'apps/tv/src/Seeded.tsx', 'apps/web/src/Seeded.tsx']) {
      expect(await hardCoded('<Button label="Play" />', file), file).toEqual(['Play']);
    }
  });

  it('skips tests, and the hello screen until step 13 replaces it', async () => {
    for (const file of ['apps/tv/src/gallery/Seeded.test.tsx', 'packages/ui/test/Seeded.tsx', 'apps/tv/src/App.tsx', 'apps/tv/src/DataPanel.tsx', 'apps/tv/src/FocusPanel.tsx']) {
      expect(await hardCoded('<p>Worker: ok</p>', file), file).toEqual([]);
    }
  });

  it('names the text and where it belongs', async () => {
    const [result] = await eslint.lintText('export const A = () => <p>Press OK on any item</p>;\n', { filePath: path.join(ROOT, GALLERY) });
    expect(result?.messages).toHaveLength(1);
    expect(result?.messages[0]?.ruleId).toBe(RULE);
    expect(result?.messages[0]?.message).toContain('"Press OK on any item"');
    expect(result?.messages[0]?.message).toContain('apps/tv/src/i18n');
  });
});
