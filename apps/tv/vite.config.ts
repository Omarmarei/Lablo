import { defineConfig } from 'vite';

/**
 * Desktop development loop (`pnpm dev`): the TV app with the browser platform adapter.
 * This is not the shipping build; tools/build/build-tv.ts produces the TV bundles.
 */
export default defineConfig({
  define: {
    __PLATFORM__: JSON.stringify('browser'),
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  server: {
    port: 5173,
  },
});
