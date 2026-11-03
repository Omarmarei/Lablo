import type { ComponentChildren } from 'preact';
import type { FocusableProps } from './focusable';
import { focusClass } from './focusable';
import { ProgressBar } from './ProgressBar';
import './Tile.css';

export interface TileProps extends FocusableProps {
  /** The provider's title (a film, a channel): its own direction. */
  readonly title: string;
  readonly subtitle?: string;
  /** A poster or logo URL; without it the tile shows its background. */
  readonly image?: string;
  /** Watched so far, 0–1 (resume). */
  readonly progress?: number;
  /** A badge in the top corner at the inline start. */
  readonly badge?: ComponentChildren;
  /** Extra classes (a background tone). */
  readonly class?: string;
}

/** A poster or channel tile, `--tile-width` × `--tile-height` (LAYOUT.tileWidth/tileHeight). */
export function Tile({ title, subtitle, image, progress, badge, class: extra, state, onHover, onPress, testId }: TileProps) {
  return (
    <div
      class={focusClass(`z-tile${extra === undefined ? '' : ` ${extra}`}`, state)}
      role="button"
      data-testid={testId}
      data-state={state ?? 'idle'}
      onMouseMove={onHover}
      onClick={onPress}
    >
      {image !== undefined && <img class="z-tile__image" src={image} alt="" />}
      {badge !== undefined && <span class="z-tile__badge">{badge}</span>}
      <div class="z-tile__caption">
        <span class="z-tile__title" dir="auto" translate={false}>
          {title}
        </span>
        {subtitle !== undefined && <span class="z-tile__subtitle">{subtitle}</span>}
      </div>
      {progress !== undefined && <ProgressBar value={progress} size="s" class="z-tile__progress" />}
    </div>
  );
}
