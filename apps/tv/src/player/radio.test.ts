import type { VNode } from 'preact';
import type { CatalogItem } from '@lablo/core';
import type { PlayerState } from '@lablo/player';
import { describe, expect, it } from 'vitest';
import { appI18n } from '../i18n';
import type { LiveRow } from '../live/live-state';
import { channelRequest, radioCard } from './radio';
import { RadioCard } from './RadioCard';

/** Radio channels (RELAY step 37b): their requests' hint, and the card in place of the picture. */

const LOGO = 'http://panel.test/logos/radio.png';

function row(radio: boolean, logo: string | null = LOGO, name = 'Lablo Radio Test'): LiveRow {
  const item: CatalogItem = {
    key: 'x:s1:live:108',
    src: 's1',
    kind: 'live',
    name,
    normName: '',
    group: 'Radio Test',
    url: 'http://panel.test/live/u/p/108.ts',
    logo,
    epgId: null,
    tvgName: null,
    matchName: null,
    chno: null,
    tvgShift: 0,
    catchup: null,
    radio,
    hints: null,
  };
  return { item, number: 9 };
}

const CANDIDATES = [{ url: 'http://panel.test/live/u/p/108.ts', container: 'ts' as const }];

describe("a channel's request", () => {
  it('says a radio stream has no picture, live and from the archive', () => {
    expect(channelRequest(row(true), 'live', CANDIDATES)).toStrictEqual({ key: 'x:s1:live:108', src: 's1', mode: 'live', candidates: CANDIDATES, hints: { audioOnly: true } });
    expect(channelRequest(row(true), 'catchup', CANDIDATES)).toStrictEqual({ key: 'x:s1:live:108', src: 's1', mode: 'catchup', candidates: CANDIDATES, hints: { audioOnly: true } });
  });

  it('carries no hint for a channel with a picture', () => {
    expect(channelRequest(row(false), 'live', CANDIDATES)).toStrictEqual({ key: 'x:s1:live:108', src: 's1', mode: 'live', candidates: CANDIDATES });
  });
});

describe('the radio card: when it shows', () => {
  it("in place of a radio channel's picture: playing, paused and reconnecting", () => {
    for (const state of ['playing', 'paused', 'reconnecting'] as const) {
      expect(radioCard(row(true), state, false, false, null)).toStrictEqual({ name: 'Lablo Radio Test', logo: LOGO });
    }
  });

  it('not while "Connecting…" has the middle, nor under an error or end card, nor before a play', () => {
    const others: PlayerState[] = ['idle', 'opening', 'buffering', 'ended', 'failed'];
    for (const state of others) expect(radioCard(row(true), state, false, false, null)).toBeNull();
  });

  it('not for a channel with a picture, no channel, a movie, or a refused play', () => {
    expect(radioCard(row(false), 'playing', false, false, null)).toBeNull();
    expect(radioCard(null, 'playing', false, false, null)).toBeNull();
    // A movie plays: the last channel's row is still `playing`.
    expect(radioCard(row(true), 'playing', true, false, null)).toBeNull();
    expect(radioCard(row(true), 'playing', false, true, null)).toBeNull();
  });

  it('the radio mark without a logo, with an empty one, or with the one that failed to load', () => {
    expect(radioCard(row(true, null), 'playing', false, false, null)).toStrictEqual({ name: 'Lablo Radio Test', logo: null });
    expect(radioCard(row(true, ''), 'playing', false, false, null)).toStrictEqual({ name: 'Lablo Radio Test', logo: null });
    expect(radioCard(row(true), 'playing', false, false, LOGO)).toStrictEqual({ name: 'Lablo Radio Test', logo: null });
    // Another channel's logo failed: this one's still shows.
    expect(radioCard(row(true), 'playing', false, false, 'http://panel.test/logos/other.png')).toStrictEqual({ name: 'Lablo Radio Test', logo: LOGO });
  });
});

type Props = Record<string, unknown> & { children?: unknown };

function kids(node: VNode): VNode[] {
  const children = (node.props as Props).children;
  return (Array.isArray(children) ? children : [children]).filter((c): c is VNode => c !== null && typeof c === 'object');
}

describe('the radio card: what it draws', () => {
  const i18n = appI18n('en-US');
  const arabic = appI18n('ar-SA');

  it('the logo whole, the name in its own direction, untranslated, and the "Radio" badge', () => {
    const failed: string[] = [];
    const root = RadioCard({ card: { name: 'Lablo Radio Test', logo: LOGO }, i18n, onLogoError: (url) => failed.push(url) }) as VNode;
    expect(root.props).toMatchObject({ class: 'player__radio', 'data-testid': 'player-radio', 'data-logo': 'true' });
    const [logo, name, badge] = kids(root);
    expect(logo!.type).toBe('img');
    expect(logo!.key).toBe(LOGO);
    expect(logo!.props).toMatchObject({ class: 'player__radio-logo', src: LOGO, alt: '' });
    // A logo that fails to load says which.
    (logo!.props as unknown as { onError: () => void }).onError();
    expect(failed).toEqual([LOGO]);
    expect(name!.props).toMatchObject({ class: 'player__radio-name', dir: 'auto', translate: false, children: 'Lablo Radio Test' });
    expect((badge!.props as Props).label).toBe('Radio');
  });

  it('the radio mark without a logo; the badge in Arabic', () => {
    const root = RadioCard({ card: { name: 'راديو لابلو', logo: null }, i18n: arabic, onLogoError: () => undefined }) as VNode;
    expect(root.props).toMatchObject({ 'data-logo': 'false' });
    const [mark, name, badge] = kids(root);
    expect(mark!.type).toBe('svg');
    expect(mark!.props).toMatchObject({ class: 'player__radio-mark', 'aria-hidden': 'true' });
    expect((name!.props as Props).children).toBe('راديو لابلو');
    expect((badge!.props as Props).label).toBe(arabic.t('badge.radio'));
    expect(arabic.t('badge.radio')).not.toBe('Radio');
  });
});
