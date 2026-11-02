/** The parts of a `MouseEvent` the watcher reads. */
interface PointerMove {
  readonly screenX: number;
  readonly screenY: number;
}

/**
 * Calls `onMove` when the pointer really moves. Chromium also sends `mousemove` while the
 * pointer stands still (after a scroll or a layout change under it); those are skipped, so
 * a list scrolling under a hidden Magic Remote pointer can't take the focus. Listens in the
 * capture phase, so the pointer counts as shown before an item's own `mousemove` handler
 * asks for the focus (`Screen.hover`). Returns a function that stops watching.
 */
export function watchPointerMoves(target: EventTarget, onMove: () => void): () => void {
  let x = NaN;
  let y = NaN;
  const listener = (event: Event): void => {
    const { screenX, screenY } = event as unknown as PointerMove;
    if (screenX === x && screenY === y) return;
    x = screenX;
    y = screenY;
    onMove();
  };
  // An options object rather than `true`: Node's EventTarget ignores a boolean on removal.
  // Engines older than Chromium 49 read the object as `useCapture = true` anyway.
  const capture = { capture: true };
  target.addEventListener('mousemove', listener, capture);
  return () => target.removeEventListener('mousemove', listener, capture);
}
