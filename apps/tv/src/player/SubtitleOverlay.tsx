import type { CaptionBackground, CaptionColor } from './appearance';
import type { SubtitleSize } from './track-menu';

interface Props {
  /** The cues showing, top to bottom (provider text, lines joined by a line break). */
  readonly cues: readonly string[];
  readonly size: SubtitleSize;
  /** Step 43: the box behind a cue and the text's colour (the defaults are today's look). */
  readonly background?: CaptionBackground;
  readonly color?: CaptionColor;
}

/**
 * The subtitle overlay (RELAY step 20b2b): the cues the controller says to draw, bottom-centre
 * in the safe area, lifted above the info bar while it shows (the player's bottom stack). Each
 * cue is a block with its own direction (`dir=auto`, so an Arabic cue in the English UI reads
 * right to left) and `translate=false`, its lines kept (`white-space: pre-line`), on a scrim.
 * The info bar, the track menu and the error card paint over it. Hook-free: the parent reads
 * the signals and passes plain data, so the overlay draws again whenever the cues change.
 */
export function SubtitleOverlay({ cues, size, background = 'dark', color = 'white' }: Props) {
  return (
    <div class={`subtitles subtitles--${size} subtitles--bg-${background} subtitles--${color}`} data-testid="subtitles" data-size={size} data-background={background} data-color={color} data-count={cues.length}>
      {cues.map((text, i) => (
        <div class="subtitles__cue" key={`${i} ${text}`}>
          <span class="subtitles__text" dir="auto" translate={false} data-testid="subtitle-cue">
            {text}
          </span>
        </div>
      ))}
    </div>
  );
}
