import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/{src,test}/**/*.test.ts',
      'apps/*/{src,test}/**/*.test.ts',
      'tools/*/{src,test}/**/*.test.ts',
      'test/**/*.test.ts',
    ],
    // ffmpeg-backed tests run with `pnpm test:media` (vitest.media.config.ts).
    exclude: [...configDefaults.exclude, '**/*.media.test.ts'],
    // The ESLint API tests load the TypeScript resolver on first use.
    testTimeout: 30_000,
  },
});
