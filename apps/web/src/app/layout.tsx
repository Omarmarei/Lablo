/**
 * The web app's root layout (RELAY step 31b): the pages around the `/v1` routes. The first is the
 * phone page `/p`; the legal pages come later. `<html lang dir>` follows the browser's
 * `Accept-Language` (the phone page sets them again from its own choice once it runs).
 */
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { dirOf, fromAcceptLanguage } from '../phone/lang';

export const metadata: Metadata = {
  // Nothing here is for search engines: the phone page is reached from a TV's QR code.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b0f14',
  colorScheme: 'dark',
};

export default async function RootLayout({ children }: { readonly children: ReactNode }): Promise<ReactNode> {
  const lang = fromAcceptLanguage((await headers()).get('accept-language')) ?? 'en';
  return (
    <html lang={lang} dir={dirOf(lang)} suppressHydrationWarning>
      <body style={{ margin: 0, background: '#0b0f14' }}>{children}</body>
    </html>
  );
}
