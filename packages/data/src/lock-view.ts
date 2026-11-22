/**
 * The query worker's locks (RELAY step 38, architecture.md §1.4 item 10, "Built in step 38a"): which categories and
 * live channels parental control locks, over the loaded catalogs' categories.
 *
 * - **A category** is adult when its panel marked one of its items adult (`CategoryInfo.adult`,
 *   kept by the ingest) or its name holds an adult word (core `adultName`). It is locked when the
 *   user locked it, or, while "Lock adult groups" is on, when it is adult and the user didn't open
 *   it (parental.ts). Its source, kind and name decide, as the user's choices are kept by them.
 * - **A live channel** is locked when the user locked it (`ChannelEdit.locked`).
 *
 * The query service serves the marks (`mark`) at every `categories`, and while the session is
 * locked asks `categoryLocked`, `channelLocked`, `itemLocked` and `searchHide` before handing out
 * anything. Built from one load and one read of the locks; the service drops it when either
 * changes.
 */

import type { CatalogItem, ContentKey, ContentKind, SearchSegment } from '@lablo/core';
import { adultName, keySource } from '@lablo/core';
import type { ChannelEdit } from './channel-edits';
import type { CategoryInfo } from './chunker';
import type { LockRef, ParentalState } from './parental';
import { lockId } from './parental';

/** One loaded catalog's categories of one kind. */
export interface LoadedCategories {
  src: string;
  kind: ContentKind;
  infos: readonly CategoryInfo[];
}

/** A catalog's locked categories: by `catIdx`, and by name. */
interface Locked {
  idx: Record<number, true>;
  names: Record<string, true>;
}

export class LockView {
  /** The user's choices, by `lockId`. */
  private readonly choices = Object.create(null) as Record<string, boolean>;
  /** Per catalog and kind (`src|kind`), its locked categories. */
  private readonly locked = Object.create(null) as Record<string, Locked>;
  /** The locked live channels' keys. */
  private readonly channels = Object.create(null) as Record<ContentKey, true>;
  /** The kinds with something locked, in `CONTENT_KINDS`' order. */
  readonly kinds: ContentKind[] = [];

  constructor(
    lists: readonly LoadedCategories[],
    private readonly state: ParentalState,
    edits: readonly ChannelEdit[],
  ) {
    for (let i = 0; i < state.groups.length; i += 1) this.choices[lockId(state.groups[i]!)] = state.groups[i]!.locked;
    const any: Record<string, true> = {};
    for (let l = 0; l < lists.length; l += 1) {
      const { src, kind, infos } = lists[l]!;
      const locked: Locked = { idx: {}, names: Object.create(null) as Record<string, true> };
      for (let c = 0; c < infos.length; c += 1) {
        const info = infos[c]!;
        if (!this.lockOf(src, kind, info).locked) continue;
        locked.idx[info.catIdx] = true;
        locked.names[info.name] = true;
        any[kind] = true;
      }
      this.locked[src + '|' + kind] = locked;
    }
    for (let e = 0; e < edits.length; e += 1) {
      if (edits[e]!.locked !== true) continue;
      this.channels[edits[e]!.key] = true;
      any['live'] = true;
    }
    const all: ContentKind[] = ['live', 'movie', 'series'];
    for (let k = 0; k < all.length; k += 1) if (any[all[k]!] === true) this.kinds.push(all[k]!);
  }

  /** Whether `info` of `src`'s `kind` is adult, and whether it is locked. */
  private lockOf(src: string, kind: ContentKind, info: CategoryInfo): { adult: boolean; locked: boolean } {
    const adult = info.adult === true || adultName(info.name);
    const ref: LockRef = { src, kind, name: info.name };
    const choice = this.choices[lockId(ref)];
    return { adult, locked: choice === undefined ? this.state.adult && adult : choice };
  }

  /** `infos` of `src`'s `kind` as served: an adult or locked one a copy with `adult` and `locked`, the others as they are. */
  mark(src: string, kind: ContentKind, infos: readonly CategoryInfo[]): CategoryInfo[] {
    return infos.map((info) => {
      const lock = this.lockOf(src, kind, info);
      if (!lock.adult && !lock.locked) return info;
      const out: CategoryInfo = { ...info };
      if (lock.adult) out.adult = true;
      if (lock.locked) out.locked = true;
      return out;
    });
  }

  /** Whether category `catIdx` of `src`'s `kind` is locked. */
  categoryLocked(src: string, kind: ContentKind, catIdx: number): boolean {
    const locked = this.locked[src + '|' + kind];
    return locked !== undefined && locked.idx[catIdx] === true;
  }

  /** Whether the user locked live channel `key`. */
  channelLocked(key: ContentKey): boolean {
    return this.channels[key] === true;
  }

  /** Whether `item` is locked: its category (its `group` is its category's name), or the channel itself. */
  itemLocked(item: CatalogItem): boolean {
    const locked = this.locked[item.src + '|' + item.kind];
    return (locked !== undefined && locked.names[item.group] === true) || (item.kind === 'live' && this.channelLocked(item.key));
  }

  /** For search: whether item `index` of `segment` is locked (`null`: nothing of the segment is). */
  searchHide(segment: SearchSegment): ((index: number) => boolean) | null {
    const locked = this.locked[segment.src + '|' + segment.kind];
    const items: Record<number, true> = {};
    let some = false;
    if (segment.kind === 'live') {
      for (const key in this.channels) {
        // (Another source's key is never looked up: a hash that only collides would hide a channel.)
        const index = keySource(key) === segment.src ? segment.indexOfKey(key) : -1;
        if (index === -1) continue;
        items[index] = true;
        some = true;
      }
    }
    if (!some && (locked === undefined || Object.keys(locked.idx).length === 0)) return null;
    return (index) => items[index] === true || (locked !== undefined && locked.idx[segment.chunkOf(index).catIdx] === true);
  }
}
