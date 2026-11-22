import type { PlayCandidate, PlayerState, PlayMode, PlayRequest } from '@lablo/player';
import type { LiveRow } from '../live/live-state';

/**
 * Radio channels (RELAY step 37b): the M3U's `radio="true"` and Xtream's `radio_streams`, which
 * the parsers mark as `item.radio`. Their streams have no picture, so their requests say so
 * (`hints.audioOnly`: the `<video>` engine then takes the clock moving as the first frame instead
 * of failing the stream as `NO_PICTURE`), and the player's stage shows the radio card in place of
 * the picture.
 */

/** The hint a radio channel's requests carry. */
const AUDIO_ONLY = { audioOnly: true } as const;

/** A channel's request (live or from its archive); a radio channel's says its stream has no picture. */
export function channelRequest(row: LiveRow, mode: PlayMode, candidates: readonly PlayCandidate[]): PlayRequest {
  const item = row.item;
  if (item.radio) return { key: item.key, src: item.src, mode, candidates, hints: AUDIO_ONLY };
  return { key: item.key, src: item.src, mode, candidates };
}

/** What the radio card shows: the channel's name, and its logo (`null`: the radio mark). */
export interface RadioCard {
  readonly name: string;
  readonly logo: string | null;
}

/**
 * The states in which the card stands in for the picture. "Connecting…" has the middle of the
 * screen to itself while the stream opens or stalls, and an error or end card replaces it.
 */
const CARD_STATES: readonly PlayerState[] = ['playing', 'paused', 'reconnecting'];

/**
 * The radio card for the channel whose stream plays (`row`: the player's `playing` row, which a
 * waiting zap leaves as it is), or `null`: not radio, a movie plays, the config refused the play,
 * or the state shows something else there. A logo that failed to load (`failedLogo`) is the mark.
 */
export function radioCard(row: LiveRow | null, state: PlayerState, movie: boolean, refused: boolean, failedLogo: string | null): RadioCard | null {
  if (row === null || !row.item.radio || movie || refused || CARD_STATES.indexOf(state) === -1) return null;
  const logo = row.item.logo;
  return { name: row.item.name, logo: logo === null || logo === '' || logo === failedLogo ? null : logo };
}
