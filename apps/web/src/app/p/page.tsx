/**
 * `/p`, the phone page (RELAY step 31b, architecture.md §3.3 A): the language from `?lang=en|ar`,
 * else the browser's `Accept-Language`, else English. Everything else happens in the browser
 * (`PhonePage`): the QR link's fragment never reaches this server.
 */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { PhonePage } from '../../phone/PhonePage';
import { t } from '../../phone/catalog';
import type { Lang } from '../../phone/lang';
import { pickLang } from '../../phone/lang';

interface PageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}

async function langOf({ searchParams }: PageProps): Promise<Lang> {
  return pickLang((await searchParams).lang, (await headers()).get('accept-language'));
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const lang = await langOf(props);
  return { title: t(lang, 'meta.title'), description: t(lang, 'meta.description') };
}

export default async function Page(props: PageProps): Promise<ReactNode> {
  return <PhonePage initialLang={await langOf(props)} />;
}
