import path from 'node:path';
import type { NextConfig } from 'next';

/** The backend (RELAY step 29a, docs/runbooks/web.md). */
const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // The workspace packages ship TypeScript source (RELAY step 30a: /v1/config reads the protocol).
  // Turbopack compiled them without this too (they resolve outside node_modules); it says so.
  transpilePackages: ['@lablo/protocol', '@lablo/crypto'],
  // The pnpm workspace's root, so Next doesn't guess from the lockfiles it finds.
  turbopack: { root: path.join(import.meta.dirname, '../..') },
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
};

export default config;
