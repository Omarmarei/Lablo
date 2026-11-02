import { describe, expect, it, vi } from 'vitest';
import { watchPointerMoves } from './pointer';

const move = (screenX: number, screenY: number): Event => Object.assign(new Event('mousemove'), { screenX, screenY });

describe('watchPointerMoves', () => {
  it('reports real moves and skips the ones where the pointer stood still', () => {
    const target = new EventTarget();
    const onMove = vi.fn();
    watchPointerMoves(target, onMove);
    target.dispatchEvent(move(10, 20));
    expect(onMove).toHaveBeenCalledTimes(1);
    // Chromium's mousemove after a scroll under a still pointer.
    target.dispatchEvent(move(10, 20));
    expect(onMove).toHaveBeenCalledTimes(1);
    target.dispatchEvent(move(11, 20));
    target.dispatchEvent(move(11, 21));
    expect(onMove).toHaveBeenCalledTimes(3);
  });

  it('listens in the capture phase, before the items', () => {
    const target = new EventTarget();
    const add = vi.spyOn(target, 'addEventListener');
    const remove = vi.spyOn(target, 'removeEventListener');
    const stop = watchPointerMoves(target, () => undefined);
    expect(add).toHaveBeenCalledWith('mousemove', expect.any(Function), { capture: true });
    stop();
    expect(remove).toHaveBeenCalledWith('mousemove', add.mock.calls[0]![1], { capture: true });
  });

  it('stops watching', () => {
    const target = new EventTarget();
    const onMove = vi.fn();
    const stop = watchPointerMoves(target, onMove);
    stop();
    target.dispatchEvent(move(1, 1));
    expect(onMove).not.toHaveBeenCalled();
  });
});
