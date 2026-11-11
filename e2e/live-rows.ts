import type { Page } from '@playwright/test';
import type { LiveChannel } from '../apps/mock-provider/src/config';
import { loadCatalog } from '../apps/mock-provider/src/config';
import { upcoming } from '../apps/mock-provider/src/epg';

/**
 * The mock's live channels as the live screen shows them, and the rows it draws (live.spec.ts,
 * refresh.spec.ts).
 */
export const catalog = loadCatalog();

/** The channels in the order "All channels" lists them: category by category, as the panel lists them. */
export const ordered: LiveChannel[] = catalog.liveCategories.flatMap((c) => catalog.live.filter((ch) => ch.categoryId === c.id));

/**
 * The channel whose programmes a channel shows: the guide's channel of its id (the first channel
 * that declares it, as the mock writes its XMLTV), or by its match name ("Lablo Sports Test FHD"
 * has no id but matches "Lablo Sports Test HD"). `null`: no guide ("18+ Test Pattern").
 */
export function guideOf(channel: LiveChannel): LiveChannel | null {
  const id = (c: LiveChannel): string | null => (c.xmltvId ?? c.epgId)?.toLowerCase() ?? null;
  const own = id(channel);
  if (own !== null) return catalog.live.find((c) => id(c) === own) ?? null;
  if (channel.name === 'Lablo Sports Test FHD') return catalog.live.find((c) => c.name === 'Lablo Sports Test HD') ?? null;
  return null;
}

/** The titles a row may show now: the programme on air when the check started or when it ended. */
export function nowTitles(channel: LiveChannel, from: number, to: number): string[] {
  const guide = guideOf(channel);
  if (guide === null) return [];
  return [upcoming(guide, from, 1)[0]!.title, upcoming(guide, to, 1)[0]!.title];
}

export interface Row {
  readonly index: number;
  readonly number: string;
  readonly name: string;
  readonly now: string;
  readonly nowTitle: string | null;
  readonly next: string | null;
  readonly state: string;
}

/** The rows the list draws, in order. */
export function rows(page: Page): Promise<Row[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid=channels] .z-vlist__item')).map((item) => {
      const text = (selector: string): string | null => item.querySelector(selector)?.textContent ?? null;
      return {
        index: Number(item.getAttribute('data-index')),
        number: text('.z-row__number') ?? '',
        name: text('.z-row__name') ?? '',
        now: text('.z-row__now') ?? '',
        nowTitle: text('.z-row__now .z-row__title'),
        next: text('.z-row__next .z-row__title'),
        state: item.querySelector('.z-row')?.getAttribute('data-state') ?? '',
      };
    }),
  );
}
