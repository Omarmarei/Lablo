/**
 * `/terms` (RELAY step 40d): the language from `?lang=en|ar`, else the browser's
 * `Accept-Language`, else English. Unlike the phone page these may be found and indexed.
 */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { legalDoc } from '@lablo/protocol/legal';
import { LegalPage } from '../../legal/LegalPage';
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
  return { title: `${legalDoc(lang, 'terms').title} · Lablo`, robots: { index: true, follow: true } };
}

export default async function Page(props: PageProps): Promise<ReactNode> {
  return <LegalPage lang={await langOf(props)} id="terms" />;
}
