import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * The phone page's content security policy (RELAY step 31b): its scripts may talk only to this
 * origin (`connect-src 'self'`), so the page can't contact a provider or anyone else, and it loads
 * nothing from another host. `'unsafe-inline'` is for Next's inline bootstrap scripts and React's
 * style attributes: a nonce would need a proxy and per-request rendering, for a page that renders
 * no one else's HTML.
 */
export const PHONE_CSP = [
  "default-src 'self'",
  "connect-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

type Headers = Awaited<ReturnType<NonNullable<NextConfig['headers']>>>;

/** The pages' headers in a production build (`/p`, `/terms`, `/privacy`); `next dev` gets none (its reloads use eval and a websocket). */
export function pageHeaders(production: boolean): Headers {
  if (!production) return [];
  return [
    {
      source: '/p',
      headers: [
        { key: 'Content-Security-Policy', value: PHONE_CSP },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
      ],
    },
    // The legal pages (step 40d): plain text pages under the same policy; they open from the stores' listings and the TV's
    // text, so they may be linked from anywhere, and send no referrer of their own.
    ...['/terms', '/privacy'].map((source) => ({
      source,
      headers: [
        { key: 'Content-Security-Policy', value: PHONE_CSP },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
      ],
    })),
  ];
}

/** The backend (RELAY step 29a, docs/runbooks/web.md) and its pages (step 31b). */
const config: NextConfig = {
  poweredByHeader: false,
  headers: async () => pageHeaders(process.env.NODE_ENV === 'production'),
  reactStrictMode: true,
  // The workspace packages ship TypeScript source (RELAY step 30a: /v1/config reads the protocol).
  // Turbopack compiled them without this too (they resolve outside node_modules); it says so.
  transpilePackages: ['@lablo/protocol', '@lablo/crypto'],
  // The pnpm workspace's root, so Next doesn't guess from the lockfiles it finds.
  turbopack: { root: path.join(import.meta.dirname, '../..') },
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
};

export default config;
