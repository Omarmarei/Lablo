import path from 'node:path';
import type { NextConfig } from 'next';

/** The backend (RELAY step 29a, docs/runbooks/web.md). */
const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // The pnpm workspace's root, so Next doesn't guess from the lockfiles it finds.
  turbopack: { root: path.join(import.meta.dirname, '../..') },
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
};

export default config;
