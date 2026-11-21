/**
 * The query worker's view of the changed channels (RELAY step 36a2, architecture.md §1.4 item 10):
 * what the loaded search segments make of the profile's `channelEdits` and "Clean channel names".
 *
 * - **Names and numbers:** a live item shows the user's name, else, with clean names on, its name
 *   without its leading tags (core's `cleanName`), else the provider's; and the user's number as
 *   its `chno`. `normName` stays the provider's, so favourites and changes made from a shown item
 *   still re-match. Movies and series show as stored.
 * - **Hidden channels** leave the live chunks the worker serves, and each live category gets
 *   `hidden`: their places in it, ascending. Everything else the worker hands out keeps the
 *   provider's addresses and counts (search hits, `items`, `itemsByKey`, `numbered`, a category's
 *   `count` and `chunks`); `shownChunks` gives a chunk's served count from the two.
 * - **Search** finds a renamed channel by its new name too (`aliases`, per segment).
 *
 * A cached chunk is never changed: an item shown otherwise is a copy. A channel is found by its
 * key's hash in its source's live segment, as a favourite's boost is (core search.ts): a 53-bit
 * collision would hide or rename another channel, about one chance in 10^10 per changed channel.
 */

import type { CatalogItem, ContentKey, SearchAliases, SearchSegment } from '@lablo/core';
import { cleanName, normalizeName, searchAliases } from '@lablo/core';
import type { ChannelEdit } from './channel-edits';
import type { CategoryInfo } from './chunker';

export class ChannelView {
  /** The renamed or renumbered channels, by key. */
  private readonly changed = new Map<ContentKey, ChannelEdit>();
  /** The renumbered channels, by number (no two have the same: `channelEditsOf`). */
  private readonly byNumber = new Map<number, ChannelEdit>();
  /** The hidden channels' slots, ascending, by stored chunk (`src|catIdx|chunk`). */
  private readonly hiddenSlots = new Map<string, number[]>();
  /** Per segment (aligned with the segments given), its renamed channels' names; `null`: none. */
  readonly aliases: (SearchAliases | null)[];

  constructor(segments: readonly SearchSegment[], edits: readonly ChannelEdit[], private readonly clean: boolean) {
    const names: { index: number; normName: string }[][] = segments.map(() => []);
    for (let e = 0; e < edits.length; e += 1) {
      const edit = edits[e]!;
      if (edit.name !== undefined || edit.number !== undefined) this.changed.set(edit.key, edit);
      if (edit.number !== undefined) this.byNumber.set(edit.number, edit);
      let s = -1;
      for (let i = 0; i < segments.length; i += 1) if (segments[i]!.src === edit.src && segments[i]!.kind === 'live') s = i;
      // (A channel the catalog doesn't hold now: nothing to hide or find.)
      const index = s === -1 ? -1 : segments[s]!.indexOfKey(edit.key);
      if (index === -1) continue;
      if (edit.hidden === true) {
        const at = segments[s]!.chunkOf(index);
        const id = `${edit.src}|${at.catIdx}|${at.chunk}`;
        const slots = this.hiddenSlots.get(id);
        if (slots === undefined) this.hiddenSlots.set(id, [at.slot]);
        else slots.push(at.slot);
      }
      if (edit.name !== undefined) names[s]!.push({ index, normName: normalizeName(edit.name) });
    }
    this.hiddenSlots.forEach((slots) => slots.sort((a, b) => a - b));
    // Each segment's names in catalog order, as its own are searched.
    this.aliases = names.map((list) => (list.length === 0 ? null : searchAliases(list.sort((a, b) => a.index - b.index))));
  }

  /** `item` as shown: a copy when its name or number differs from the stored ones, else `item` itself. */
  show(item: CatalogItem): CatalogItem {
    if (item.kind !== 'live') return item;
    const edit = this.changed.get(item.key);
    const name = edit !== undefined && edit.name !== undefined ? edit.name : this.clean ? cleanName(item.name) : item.name;
    const chno = edit !== undefined && edit.number !== undefined ? edit.number : item.chno;
    return name === item.name && chno === item.chno ? item : { ...item, name, chno };
  }

  /** Stored live chunk `chunk` of category `catIdx` of `src` as served: its hidden channels out, the others shown. */
  chunk(src: string, catIdx: number, chunk: number, items: readonly CatalogItem[]): CatalogItem[] {
    const slots = this.hiddenSlots.get(`${src}|${catIdx}|${chunk}`);
    const out: CatalogItem[] = [];
    for (let slot = 0; slot < items.length; slot += 1) if (slots === undefined || slots.indexOf(slot) === -1) out.push(this.show(items[slot]!));
    return out;
  }

  /** Source `src`'s live categories, each with its hidden channels' places (`hidden`, ascending) when it has any: a copy then. */
  categories(src: string, infos: readonly CategoryInfo[]): CategoryInfo[] {
    return infos.map((info) => {
      const hidden: number[] = [];
      let start = 0;
      for (let c = 0; c < info.chunks.length; c += 1) {
        const slots = this.hiddenSlots.get(`${src}|${info.catIdx}|${c}`);
        if (slots !== undefined) for (let i = 0; i < slots.length; i += 1) hidden.push(start + slots[i]!);
        start += info.chunks[c]!;
      }
      return hidden.length === 0 ? info : { ...info, hidden };
    });
  }

  /** The changed channel the user numbered `number`, or `undefined`. */
  numbered(number: number): ChannelEdit | undefined {
    return this.byNumber.get(number);
  }
}
