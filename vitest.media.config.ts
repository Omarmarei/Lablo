import { defineConfig } from 'vitest/config';

// `pnpm test:media`: the tests that need ffmpeg/ffprobe and the generated media (RELAY step 4).
// Kept out of `pnpm test` (see vitest.config.ts); CI runs them in the `media` job.
export default defineConfig({
  test: {
    include: ['apps/*/test/**/*.media.test.ts', 'tools/*/{src,test}/**/*.media.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 15 * 60_000,
  },
});
