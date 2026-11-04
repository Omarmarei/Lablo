import type { EpgProgramme } from '@zoma/core';
import type { EpgNowNext } from '@zoma/data';
import type { PlaybackFailure } from '@zoma/player';
import type { FocusBinding, Screen } from '@zoma/ui';
import { Badge, Button, ProgressBar, Spinner, useFocus, useZone } from '@zoma/ui';
import type { AppI18n, MessageKey } from '../i18n';
import type { Live, LiveRow } from '../live/live-state';
import type { Player } from './player-state';
import { STATS_ACTION, TRACKS_ACTION } from './player-state';
import { StreamInfoPanel } from './StreamInfoPanel';
import { SubtitleOverlay } from './SubtitleOverlay';
import { TrackMenuPanel } from './TrackMenuPanel';
import './player.css';

const MINUTE_MS = 60_000;

/** The card's title and advice for each of the classifier's four categories. */
const CATEGORY_TEXT: Readonly<Record<PlaybackFailure['category'], readonly [MessageKey, MessageKey]>> = {
  internet: ['player.internet.title', 'player.internet.advice'],
  provider: ['player.provider.title', 'player.provider.advice'],
  device: ['player.device.title', 'player.device.advice'],
  app: ['player.app.title', 'player.app.advice'],
};

/** The account's own problem says more than the category's advice. */
const ACCOUNT_TEXT: Readonly<Record<string, MessageKey>> = {
  'PRV-AUTH': 'player.account.refused',
  'PRV-EXPIRED': 'player.account.expired',
  'PRV-BLOCKED': 'player.account.blocked',
  'PRV-MAX-CONNECTIONS': 'player.account.full',
};

/** A programme's start and end in the locale's time, and how far it has gone. */
function span(i18n: AppI18n, programme: EpgProgramme): string {
  return `${i18n.time(new Date(programme.start * MINUTE_MS))} – ${i18n.time(new Date(programme.end * MINUTE_MS))}`;
}

interface InfoBarProps {
  readonly live: Live;
  readonly player: Player;
  readonly i18n: AppI18n;
  readonly screen: Screen;
  readonly binding: FocusBinding;
  /**
   * The channel and its now/next, read by the parent: @preact/signals skips drawing a child whose
   * props didn't change, and the rows and guides are plain data behind `live.version`.
   */
  readonly row: LiveRow | null;
  readonly guide: EpgNowNext | undefined;
}

function InfoBar({ live, player, i18n, screen, binding, row, guide }: InfoBarProps) {
  const { t } = i18n;
  const clock = live.clock.value;
  const now = guide === undefined ? null : guide.now;
  const next = guide === undefined ? null : guide.next;
  const progress = now === null || now.end <= now.start ? 0 : (clock - now.start * MINUTE_MS) / ((now.end - now.start) * MINUTE_MS);
  const actions = useZone(binding, screen, 'actions');
  return (
    <section class="player__bar" data-testid="player-bar">
      <div class="player__head">
        <span class="player__number" data-testid="player-number">
          {row === null ? '' : row.number}
        </span>
        <span class="player__name" dir="auto" translate={false} data-testid="player-name">
          {row === null ? '' : row.item.name}
        </span>
        {row !== null && row.item.catchup !== null && <Badge label={t('badge.catchUp')} />}
        <span class="player__clock">{i18n.time(new Date(clock))}</span>
      </div>
      {now !== null ? (
        <div class="player__now" data-testid="player-now">
          <span class="player__time">{span(i18n, now)}</span>
          <ProgressBar value={progress} size="s" class="player__progress" />
          <span class="player__title" dir="auto" translate={false}>
            {now.title}
          </span>
        </div>
      ) : (
        <div class="player__now player__now--none">{guide === undefined ? '' : t('guide.none')}</div>
      )}
      {next !== null && (
        <div class="player__next" data-testid="player-next">
          <span class="player__time">
            {t('guide.next')} · {i18n.time(new Date(next.start * MINUTE_MS))}
          </span>
          <span class="player__title" dir="auto" translate={false}>
            {next.title}
          </span>
        </div>
      )}
      <div class="player__actions">
        <Button label={t('player.previous')} disabled={player.previous.value === -1} {...actions.item(0)} testId="player-previous" />
        <Button label={t('player.tracks')} {...actions.item(TRACKS_ACTION)} testId="player-tracks" />
        <Button label={t('player.streamInfo')} {...actions.item(STATS_ACTION)} testId="player-stats" />
      </div>
    </section>
  );
}

function ErrorCard({ failure, i18n, screen, binding }: { failure: PlaybackFailure; i18n: AppI18n; screen: Screen; binding: FocusBinding }) {
  const { t } = i18n;
  const [title, advice] = CATEGORY_TEXT[failure.category];
  const own = ACCOUNT_TEXT[failure.code];
  const account = failure.account;
  const buttons = useZone(binding, screen, 'card');
  return (
    <section class="player__card" role="alertdialog" data-testid="player-card" data-category={failure.category}>
      <h2 class="player__card-title">{t(title)}</h2>
      <p class="player__card-text">{t(own ?? advice)}</p>
      {account !== null && account.expDate !== null && (
        <p class="player__card-detail" data-testid="player-expiry">
          {t('player.account.expiry', { date: i18n.date(new Date(account.expDate * 1000), 'full') })}
        </p>
      )}
      {account !== null && account.activeCons !== null && account.maxConnections !== null && account.maxConnections > 0 && (
        <p class="player__card-detail" data-testid="player-connections">
          {t('player.account.connections', { active: account.activeCons, max: account.maxConnections })}
        </p>
      )}
      <p class="player__card-code" data-testid="player-code">
        {t('player.code', { code: failure.code })}
      </p>
      <div class="player__card-buttons">
        <Button label={t('player.retry')} variant="primary" {...buttons.item(0)} testId="player-retry" />
        <Button label={t('player.channels')} {...buttons.item(1)} testId="player-close" />
      </div>
    </section>
  );
}

/**
 * The player route (RELAY step 20a): drawn over the stage, so the page itself stays transparent.
 * The info bar, the number being typed, "Connecting…", the "Reconnecting…" badge and the error
 * card. Its root carries the focus (`data-screen/zone/index`) and the player's state for tests.
 * The subtitles (step 20b2b) share the bottom of the safe area with the info bar, above it. The
 * stream info (step 20c2a) sits under the badge; the error card replaces it while it shows.
 */
export function PlayerScreen({ live, player, i18n }: { live: Live; player: Player; i18n: AppI18n }) {
  const { t } = i18n;
  const binding = live.binding;
  const focus = useFocus(binding);
  const screen = player.screen.value;
  const status = player.status.value;
  const target = player.target.value;
  const playing = player.playing.value;
  const entry = player.entry.value;
  // Read here so that the bar draws again when its row's chunk or now/next arrives.
  const version = live.version.value;
  // A zap that waits hides the old channel's card and spinner: the bar shows the new one.
  const current = target === playing;
  const failure = current && status.state === 'failed' ? status.failure : null;
  const row = player.row(target);
  const guide = row === null ? undefined : live.guide(row.item.key);
  const waiting = current && (status.state === 'opening' || status.state === 'buffering');
  const menu = player.menu.screen.value;
  const subtitles = player.subtitles.value;
  const stats = player.streamInfo.shown.value;
  const info = player.streamInfo.info.value;
  return (
    <main
      class="player"
      data-testid="player"
      data-screen={focus.screen}
      data-zone={focus.zone}
      data-index={focus.index}
      data-pointer={String(focus.pointer)}
      data-dir={focus.dir}
      data-language={i18n.locale.pseudo ? 'pseudo' : i18n.locale.language}
      data-state={status.state}
      data-session={status.session}
      data-container={status.container ?? ''}
      data-failure={failure === null ? '' : failure.code}
      data-target={target}
      data-playing={playing}
      data-previous={player.previous.value}
      data-plays={player.plays.value}
      data-info={String(player.info.value)}
      data-entry={entry === null ? '' : entry.phase}
      data-version={version}
      data-pending={live.pending.value}
      data-menu={String(menu !== null)}
      data-subtitles={subtitles.feed ?? ''}
      data-stats={String(stats)}
    >
      {waiting && (
        <div class="player__wait" data-testid="player-wait">
          <Spinner size="l" label={t('player.connecting')} />
          <p class="player__wait-text">{t('player.connecting')}</p>
        </div>
      )}
      <div class="player__top">
        {current && status.state === 'reconnecting' && (
          <div class="player__badge" data-testid="player-reconnecting">
            <Badge label={t('player.reconnecting')} tone="warn" />
          </div>
        )}
        {stats && failure === null && <StreamInfoPanel info={info} container={status.container} i18n={i18n} />}
      </div>
      {entry !== null && (
        <div class="player__entry" data-testid="player-entry">
          <span class="player__digits" dir="ltr">
            {entry.digits}
          </span>
          {entry.phase === 'missing' && <p class="player__entry-text">{t('player.noChannel', { number: entry.digits })}</p>}
        </div>
      )}
      <div class="player__bottom">
        {subtitles.cues.length > 0 && <SubtitleOverlay cues={subtitles.cues} size={player.menu.size.value} />}
        {screen !== null && menu === null && player.info.value && <InfoBar live={live} player={player} i18n={i18n} screen={screen} binding={binding} row={row} guide={guide} />}
      </div>
      {menu !== null && <TrackMenuPanel menu={player.menu} tracks={status.tracks} feed={subtitles.feed} i18n={i18n} screen={menu} binding={binding} />}
      {screen !== null && failure !== null && <ErrorCard failure={failure} i18n={i18n} screen={screen} binding={binding} />}
    </main>
  );
}
