import { defineConfig } from 'vite';
import { tvPostcssPlugins } from '../../tv-css.config';
import { defineValues, tvDefines } from '../../tv-defines.config';

/**
 * Desktop development loop (`pnpm dev`): the TV app with the browser platform adapter.
 * This is not the shipping build; tools/build/build-tv.ts produces the TV bundles.
 */
export default defineConfig({
  define: {
    __PLATFORM__: JSON.stringify('browser'),
    // The API base, the version and the config keys: the dev app trusts the dev key too (tv-defines.config.ts).
    ...defineValues(tvDefines('dev')),
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  // The TV build's PostCSS plugins (postcss-rtlcss), so dev mirrors RTL layouts as the TVs do.
  css: {
    postcss: { plugins: tvPostcssPlugins() },
  },
  server: {
    port: 5173,
  },
  // Only the ingest worker imports fflate, and Vite's start-up scan doesn't follow `?worker`
  // imports. Found late, it is pre-bundled then and every open page reloads, which resets
  // the app in the middle of a key-driven e2e test (seen with a cold cache, as in CI). The
  // config worker (RELAY step 30b2, started after the first paint) brings zod, tweetnacl and
  // noble the same way.
  optimizeDeps: {
    include: [
      '@lablo/data > fflate',
      '@lablo/protocol > zod/mini',
      '@lablo/crypto > tweetnacl',
      '@lablo/crypto > @noble/hashes/utils.js',
      '@lablo/crypto > @noble/hashes/sha2.js',
      '@lablo/crypto > @noble/hashes/hmac.js',
      '@lablo/crypto > @noble/hashes/hkdf.js',
      '@lablo/crypto > @noble/hashes/scrypt.js',
    ],
  },
});
