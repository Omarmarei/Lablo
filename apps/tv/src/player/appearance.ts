import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';

/**
 * How text looks (RELAY step 43, Omar's answers): "Larger text" (ONE on/off row, about +25% on
 * every text size, tokens.css `html[data-large-text='on']`) and the captions' background and
 * colour (Settings › "Player"). The profile keeps them (`player-memory.ts`, `player.options`);
 * main reads them at the start (`set`) and Settings changes them through main. Plain signals, so
 * the subtitle overlay draws again at once. Main-safe: no regex, `trim`, `.sort(` or spread.
 */

/** The box behind a caption: today's scrim first (the default), none, or a solid black. */
export type CaptionBackground = 'dark' | 'none' | 'solid';
export const CAPTION_BACKGROUNDS: readonly CaptionBackground[] = ['dark', 'none', 'solid'];
export const DEFAULT_CAPTION_BACKGROUND: CaptionBackground = 'dark';

/** The caption's text colour: white (the default), then three that read on a dark box. */
export type CaptionColor = 'white' | 'yellow' | 'cyan' | 'green';
export const CAPTION_COLORS: readonly CaptionColor[] = ['white', 'yellow', 'cyan', 'green'];
export const DEFAULT_CAPTION_COLOR: CaptionColor = 'white';

/** A stored word as a background (anything unknown is the default). */
export function asCaptionBackground(value: unknown): CaptionBackground {
  return CAPTION_BACKGROUNDS.indexOf(value as CaptionBackground) !== -1 ? (value as CaptionBackground) : DEFAULT_CAPTION_BACKGROUND;
}

/** A stored word as a colour (anything unknown is the default). */
export function asCaptionColor(value: unknown): CaptionColor {
  return CAPTION_COLORS.indexOf(value as CaptionColor) !== -1 ? (value as CaptionColor) : DEFAULT_CAPTION_COLOR;
}

export interface Appearance {
  readonly largeText: ReadonlySignal<boolean>;
  readonly captionBackground: ReadonlySignal<CaptionBackground>;
  readonly captionColor: ReadonlySignal<CaptionColor>;
  setLargeText(on: boolean): void;
  setCaptionBackground(value: CaptionBackground): void;
  setCaptionColor(value: CaptionColor): void;
}

/** The values and what to do when large text changes (main sets `data-large-text` on `<html>`). */
export function createAppearance(onLargeText: (on: boolean) => void): Appearance {
  const largeText = signal(false);
  const captionBackground = signal<CaptionBackground>(DEFAULT_CAPTION_BACKGROUND);
  const captionColor = signal<CaptionColor>(DEFAULT_CAPTION_COLOR);
  return {
    largeText,
    captionBackground,
    captionColor,
    setLargeText(on: boolean): void {
      largeText.value = on;
      onLargeText(on);
    },
    setCaptionBackground(value: CaptionBackground): void {
      captionBackground.value = value;
    },
    setCaptionColor(value: CaptionColor): void {
      captionColor.value = value;
    },
  };
}

/** The app's own (main and the player read it; Settings changes it through main). */
export const appearance: Appearance = createAppearance((on) => setLargeTextAttribute(document.documentElement, on));

/** `<html data-large-text>`: `on` while large text is on, else absent. */
export function setLargeTextAttribute(root: Element, on: boolean): void {
  if (on) root.setAttribute('data-large-text', 'on');
  else root.removeAttribute('data-large-text');
}
