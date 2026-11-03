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

  constructor(readonly parts: readonly ListPart[]) {
    let at = 0;
    for (const part of parts) {
      this.starts.push(at);
      at += sum(part.chunks);
    }
    this.count = at;
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
