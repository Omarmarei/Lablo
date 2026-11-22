import { Badge } from '@lablo/ui';
import type { AppI18n } from '../i18n';
import type { RadioCard as Card } from './radio';

/** The radio mark (a mast sending waves both ways), for a radio channel without a logo. */
const RADIO_MARK = (
  <svg class="player__radio-mark" viewBox="0 0 24 24" aria-hidden="true" data-testid="player-radio-mark">
    <circle cx="12" cy="12" r="2.5" fill="currentColor" />
    <path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
  </svg>
);

/**
 * The radio card (RELAY step 37b), in place of the picture a radio channel's stream doesn't have:
 * its logo whole (or the radio mark), its name (the provider's: its own direction) and the "Radio"
 * badge, in the middle of the dark stage. Hook-free: a logo that fails to load calls `onLogoError`,
 * and the player draws the card again with the mark.
 */
export function RadioCard({ card, i18n, onLogoError }: { card: Card; i18n: AppI18n; onLogoError: (url: string) => void }) {
  const logo = card.logo;
  return (
    <section class="player__radio" data-testid="player-radio" data-logo={logo === null ? 'false' : 'true'}>
      {logo === null ? RADIO_MARK : <img key={logo} class="player__radio-logo" src={logo} alt="" onError={() => onLogoError(logo)} data-testid="player-radio-logo" />}
      <p class="player__radio-name" dir="auto" translate={false} data-testid="player-radio-name">
        {card.name}
      </p>
      <Badge label={i18n.t('badge.radio')} />
    </section>
  );
}
