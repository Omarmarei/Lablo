import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_LAZY, lazyProblems } from './lazy-files';

const ROOT = path.resolve('/repo');
const at = (file: string): string => path.join(ROOT, ...file.split('/'));
const lazy = (fileName: string) => ({ fileName, code: '', inlinedBytes: 0, modules: [] });

describe('the lazy files of a split app build (RELAY step 35e)', () => {
  it('wants settings.js, with all of apps/tv/src/settings/ in it', () => {
    expect(APP_LAZY).toEqual({ files: ['settings.js'], only: ['apps/tv/src/settings/', 'packages/protocol/src/legal.ts'] });
  });

  it('passes a build whose main.js holds none of those folders', () => {
    const modules = [at('apps/tv/src/main.tsx'), at('apps/tv/src/lazy/lazy-file.ts'), at('apps/tv/src/settings-other/x.ts'), '\0lablo-worker:' + at('apps/tv/src/settings/x.worker.ts')];
    expect(lazyProblems({ modules, lazy: [lazy('settings.js')] }, APP_LAZY, ROOT)).toEqual([]);
  });

  it('names each module of those folders that main.js holds', () => {
    const modules = [at('apps/tv/src/main.tsx'), at('apps/tv/src/settings/backup-state.ts'), at('apps/tv/src/settings/MappingPage.tsx')];
    expect(lazyProblems({ modules, lazy: [lazy('settings.js')] }, APP_LAZY, ROOT)).toEqual([
      'apps/tv/src/settings/backup-state.ts is in main.js: something main.js holds imports it statically (only the import() that loads settings.js may)',
      'apps/tv/src/settings/MappingPage.tsx is in main.js: something main.js holds imports it statically (only the import() that loads settings.js may)',
    ]);
  });

  it('names the legal text when main.js holds it (step 40d)', () => {
    const modules = [at('apps/tv/src/main.tsx'), at('packages/protocol/src/legal.ts'), at('packages/protocol/src/legal-other.ts')];
    expect(lazyProblems({ modules, lazy: [lazy('settings.js')] }, APP_LAZY, ROOT).slice(0, 1)).toEqual([
      'packages/protocol/src/legal.ts is in main.js: something main.js holds imports it statically (only the import() that loads settings.js may)',
    ]);
  });

  it('wants exactly the lazy files named, in order', () => {
    const modules = [at('apps/tv/src/main.tsx')];
    expect(lazyProblems({ modules, lazy: [] }, APP_LAZY, ROOT)).toEqual(['the lazy files are none, not settings.js']);
    expect(lazyProblems({ modules, lazy: [lazy('settings.js'), lazy('help.js')] }, APP_LAZY, ROOT)).toEqual(['the lazy files are settings.js, help.js, not settings.js']);
    expect(lazyProblems({ modules, lazy: [lazy('settings2.js')] }, APP_LAZY, ROOT)).toEqual(['the lazy files are settings2.js, not settings.js']);
  });
});
