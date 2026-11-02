import type { Direction, Rect } from './types';

/** Weight of the sideways offset against the distance ahead: items in line win. */
const CROSS_WEIGHT = 2;

/**
 * How far `to` lies from `from` in `direction`: the gap ahead plus the weighted sideways
 * offset (0 when the two overlap sideways). `Infinity` when the centre of `to` is not
 * beyond the centre of `from`.
 */
function distance(from: Rect, to: Rect, direction: Direction): number {
  const vertical = direction === 'up' || direction === 'down';
  const sign = direction === 'down' || direction === 'end' ? 1 : -1;
  const a0 = vertical ? from.y : from.x;
  const a1 = a0 + (vertical ? from.height : from.width);
  const b0 = vertical ? to.y : to.x;
  const b1 = b0 + (vertical ? to.height : to.width);
  // Centres compared doubled, to stay in integers.
  if (sign * (b0 + b1 - (a0 + a1)) <= 0) return Infinity;
  const gap = Math.max(0, sign > 0 ? b0 - a1 : a0 - b1);
  const c0 = vertical ? from.x : from.y;
  const c1 = c0 + (vertical ? from.width : from.height);
  const d0 = vertical ? to.x : to.y;
  const d1 = d0 + (vertical ? to.width : to.height);
  return gap + CROSS_WEIGHT * Math.max(0, d0 - c1, c0 - d1);
}

/**
 * The nearest item in `direction` from item `index`, or `null` when there is none (the
 * focus leaves the zone). Ties go to the lower index. The rects are logical (`x` from the
 * inline start), so `end` is the larger `x` in both directions.
 */
export function freeStep(rects: readonly Rect[], index: number, direction: Direction): number | null {
  const from = rects[index];
  if (from === undefined) return null;
  let best: number | null = null;
  let bestDistance = Infinity;
  for (let i = 0; i < rects.length; i += 1) {
    if (i === index) continue;
    const d = distance(from, rects[i]!, direction);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  }
  return best;
}
