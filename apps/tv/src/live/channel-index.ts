/**
 * Where row `n` of a channel list is stored (RELAY step 14a). A list is one or more categories
 * ("All channels" is every category of every source, in order). The ingest stores each category
 * in chunks of up to 500 items (`CategoryInfo.chunks`), so a row is a (source, category, chunk,
 * slot) address, found by binary search over the parts' start rows and a walk over one part's
 * chunks. Nothing here reads data: the live screen asks the query worker for the chunks the rows
 * on show need, and nothing else.
 */

/** One category of one source, as the list reads it. */
export interface ListPart {
  readonly src: string;
  readonly catIdx: number;
  /** The item count of each chunk, by chunk number. */
  readonly chunks: readonly number[];
  /**
   * Its first item's place in the provider's whole list (every category of every source, hidden
   * ones too, in the provider's order; step 35c): a channel without a number is numbered by it.
   */
  readonly first: number;
}

/** A chunk of a category of a source. */
export interface ChunkRef {
  readonly src: string;
  readonly catIdx: number;
  readonly chunk: number;
}

/** A row's place in its chunk. */
export interface ItemAddress extends ChunkRef {
  readonly slot: number;
}

/** The key of a chunk in the screen's cache. */
export function chunkId(ref: ChunkRef): string {
  return `${ref.src}|${ref.catIdx}|${ref.chunk}`;
}

function sum(counts: readonly number[]): number {
  let total = 0;
  for (const n of counts) total += Math.max(0, n);
  return total;
}

export class ChannelIndex {
  /** Rows in the list. */
  readonly count: number;
  /** The first row of each part. */
  private readonly starts: number[] = [];
  /** Each part's rows. */
  private readonly sizes: number[] = [];

  constructor(readonly parts: readonly ListPart[]) {
    let at = 0;
    for (const part of parts) {
      const size = sum(part.chunks);
      this.starts.push(at);
      this.sizes.push(size);
      at += size;
    }
    this.count = at;
  }

  /** Row `row`'s place in the provider's whole list (its part's `first` plus its place in the part), or -1 outside the list. */
  place(row: number): number {
    if (!(row >= 0 && row < this.count)) return -1;
    const p = this.partOf(row);
    return this.parts[p]!.first + row - this.starts[p]!;
  }

  /** The row at place `place` of the provider's whole list, or -1 when no part of this list holds it. */
  rowOfPlace(place: number): number {
    for (let p = 0; p < this.parts.length; p += 1) {
      const offset = place - this.parts[p]!.first;
      if (offset >= 0 && offset < this.sizes[p]!) return this.starts[p]! + offset;
    }
    return -1;
  }

  /**
   * The part holding `row`: the last part starting at or before it (binary search). An empty part
   * starts where the next one does, so the last such part is the one with rows.
   */
  private partOf(row: number): number {
    let lo = 0;
    let hi = this.parts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.starts[mid] ?? 0) <= row) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Where `row` is stored, or `null` outside `[0, count)`. */
  locate(row: number): ItemAddress | null {
    if (!(row >= 0 && row < this.count) || Math.floor(row) !== row) return null;
    const p = this.partOf(row);
    const part = this.parts[p]!;
    let slot = row - (this.starts[p] ?? 0);
    for (let chunk = 0; chunk < part.chunks.length; chunk += 1) {
      const size = Math.max(0, part.chunks[chunk] ?? 0);
      if (slot < size) return { src: part.src, catIdx: part.catIdx, chunk, slot };
      slot -= size;
    }
    return null;
  }

  /**
   * The row of the first item of chunk `ref`, or -1 when the list doesn't hold it (the player's
   * number entry reads whole chunks, RELAY step 20a).
   */
  firstRow(ref: ChunkRef): number {
    for (let p = 0; p < this.parts.length; p += 1) {
      const part = this.parts[p]!;
      if (part.src !== ref.src || part.catIdx !== ref.catIdx) continue;
      if (!(ref.chunk >= 0 && ref.chunk < part.chunks.length)) return -1;
      let row = this.starts[p] ?? 0;
      for (let c = 0; c < ref.chunk; c += 1) row += Math.max(0, part.chunks[c] ?? 0);
      return row;
    }
    return -1;
  }

  /** The chunks rows `[from, to)` are stored in, in row order, each once. */
  chunksFor(from: number, to: number): ChunkRef[] {
    const out: ChunkRef[] = [];
    const first = Math.max(0, Math.floor(from));
    const last = Math.min(this.count, Math.ceil(to));
    let row = first;
    while (row < last) {
      const at = this.locate(row);
      if (at === null) break;
      out.push({ src: at.src, catIdx: at.catIdx, chunk: at.chunk });
      const part = this.parts[this.partOf(row)]!;
      // Skip to the chunk's next row.
      row += Math.max(1, (part.chunks[at.chunk] ?? 0) - at.slot);
    }
    return out;
  }
}
