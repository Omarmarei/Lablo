/**
 * Groups one kind's catalog items into stored chunks (architecture.md §1.4 step 7): up to 500
 * items of one category per record, keyed `[src, gen, kind, catIdx, chunk]`, which cuts
 * IndexedDB record overhead about 500x on old LevelDB.
 *
 * Categories are numbered (`catIdx`) in the order they first appear. A category's chunk is
 * written when it fills up. To bound memory when items of many categories arrive interleaved
 * (an Xtream list is in id order, not category order), the largest buffer is flushed early as a
 * partial chunk once `maxBuffered` items are waiting, so chunks can hold fewer than 500 items;
 * the category record lists each chunk's size.
 *
 * Feed the emitted chunks to `SearchIndexBuilder` in emission order (`indexChunk`), so the
 * index's item numbers follow the chunks.
 */

import type { CatalogItem, ContentKind, SearchIndexBuilder } from '@lablo/core';

export const CHUNK_SIZE = 500;
export const MAX_BUFFERED = 5000;

export interface CatalogChunk {
  kind: ContentKind;
  catIdx: number;
  chunk: number;
  items: CatalogItem[];
}

export interface CategoryInfo {
  catIdx: number;
  /** Category or group title as the provider wrote it (`''`: none). */
  name: string;
  /** Items in all its chunks. */
  count: number;
  /** Item count of each chunk, by chunk number. */
  chunks: number[];
}

export interface ChunkerOptions {
  chunkSize?: number;
  maxBuffered?: number;
}

interface Pending {
  info: CategoryInfo;
  items: CatalogItem[];
}

export class CatalogChunker {
  private readonly size: number;
  private readonly maxBuffered: number;
  private readonly byName = new Map<string, Pending>();
  private readonly order: Pending[] = [];
  private buffered = 0;

  constructor(
    readonly kind: ContentKind,
    options: ChunkerOptions = {},
  ) {
    this.size = Math.max(1, options.chunkSize ?? CHUNK_SIZE);
    this.maxBuffered = Math.max(this.size, options.maxBuffered ?? MAX_BUFFERED);
  }

  /** Adds an item; returns the chunks that became ready. */
  push(item: CatalogItem): CatalogChunk[] {
    if (item.kind !== this.kind) throw new RangeError(`A ${this.kind} chunker got a ${item.kind} item`);
    let pending = this.byName.get(item.group);
    if (!pending) {
      pending = { info: { catIdx: this.order.length, name: item.group, count: 0, chunks: [] }, items: [] };
      this.byName.set(item.group, pending);
      this.order.push(pending);
    }
    pending.items.push(item);
    this.buffered++;
    const out: CatalogChunk[] = [];
    if (pending.items.length >= this.size) out.push(this.flush(pending));
    if (this.buffered > this.maxBuffered) {
      let largest = this.order[0]!;
      for (const p of this.order) if (p.items.length > largest.items.length) largest = p;
      out.push(this.flush(largest));
    }
    return out;
  }

  /** Flushes every partly filled category, in category order. */
  end(): CatalogChunk[] {
    const out: CatalogChunk[] = [];
    for (const p of this.order) if (p.items.length > 0) out.push(this.flush(p));
    return out;
  }

  /** The categories so far, by `catIdx`. */
  categories(): CategoryInfo[] {
    return this.order.map((p) => ({ ...p.info, chunks: p.info.chunks.slice() }));
  }

  private flush(p: Pending): CatalogChunk {
    const items = p.items;
    p.items = [];
    this.buffered -= items.length;
    const chunk: CatalogChunk = { kind: this.kind, catIdx: p.info.catIdx, chunk: p.info.chunks.length, items };
    p.info.chunks.push(items.length);
    p.info.count += items.length;
    return chunk;
  }
}

/** Adds a chunk's items to a search index builder (call in emission order). */
export function indexChunk(builder: SearchIndexBuilder, chunk: CatalogChunk): void {
  builder.beginChunk(chunk.catIdx, chunk.chunk);
  for (const item of chunk.items) builder.add(item.key, item.normName);
}
