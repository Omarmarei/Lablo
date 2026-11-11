import type { EpgProgramme } from '@zoma/core';
import type { EpgNowNext } from '@zoma/data';
import type { PictureMode, PlaybackFailure } from '@zoma/player';
import type { FocusBinding, ItemState, Screen } from '@zoma/ui';
import { Badge, Button, ProgressBar, Spinner, useFocus, useZone } from '@zoma/ui';
import type { AppI18n, MessageKey } from '../i18n';
import type { Live, LiveRow } from '../live/live-state';
import type { ArchiveProgramme } from './catchup';
import type { Player, PlayerAction, PlayingMovie } from './player-state';
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

/** Each picture mode's name on the info bar's "Picture" button (step 20c2b). */
const PICTURE_TEXT: Readonly<Record<PictureMode, MessageKey>> = {
  fit: 'player.picture.fit',
  zoom: 'player.picture.zoom',
  stretch: 'player.picture.stretch',
  '4:3': 'player.picture.43',
};

/** A programme's start and end in the locale's time. */
function span(i18n: AppI18n, programme: Pick<EpgProgramme, 'start' | 'end'>): string {
  return `${i18n.time(new Date(programme.start * MINUTE_MS))} – ${i18n.time(new Date(programme.end * MINUTE_MS))}`;
}

/** Where a seek bar counts from and how long it is (ms; a movie's length may be unknown: `null`). */
interface SeekSpan {
  readonly start: number;
  readonly length: number | null;
}

/** A catch-up's span: its programme. */
function archiveSpan(archive: ArchiveProgramme): SeekSpan {
  return { start: archive.start * MINUTE_MS, length: Math.max(0, (archive.end - archive.start) * MINUTE_MS) };
}

/**
 * A catch-up's seek bar (step 25d): "Paused" while paused, the time from the programme's start
 * and its length around the bar (left to right in every language), and the time it aired there.
 * A waiting seek shows its target; past now, "Live". It reads the position itself, so only it
 * draws again every second. A movie's (step 26c) counts from its start over its length (none
 * shown while it isn't known), with no time aired.
 */
function SeekBar({ player, i18n, span, movie, state, onHover, onPress }: { player: Player; i18n: AppI18n; span: SeekSpan; movie: boolean; state: ItemState; onHover: () => void; onPress: () => void }) {
  const { t } = i18n;
  const position = player.position.value;
  const { start, length } = span;
  const at = position === null ? start : position.time;
  const elapsed = Math.min(length === null ? Infinity : length, Math.max(0, at - start));
  const seeking = position !== null && position.seeking;
  const live = position !== null && position.live;
  return (
    <div
      class={`player__seek${seeking ? ' is-seeking' : ''}${state === 'focused' ? ' is-focused' : state === 'memory' ? ' is-memory' : ''}`}
      data-testid="player-seek"
      data-at={at}
      data-seeking={String(seeking)}
      data-live={String(live)}
      onMouseEnter={onHover}
      onClick={onPress}
    >
      {player.status.value.state === 'paused' && <Badge label={t('player.paused')} />}
      <div class="player__timeline" dir="ltr">
        <span class="player__elapsed" data-testid="player-elapsed">
          {i18n.duration(elapsed / 1000)}
        </span>
        <ProgressBar value={length !== null && length > 0 ? elapsed / length : 0} media size="s" label={t(movie ? 'player.moviePosition' : 'player.position')} class="player__seekbar" />
        <span class="player__length" data-testid="player-length">
          {length === null ? '' : i18n.duration(length / 1000)}
        </span>
      </div>
      {!movie && (
        <span class="player__aired" data-testid="player-aired">
          {live ? t('player.live') : t('player.aired', { time: i18n.time(new Date(at)) })}
        </span>
      )}
    </div>
  );
}

/** Each info bar button's label and test id. */
function actionButton(player: Player, i18n: AppI18n, action: PlayerAction, binding: ReturnType<typeof useZone>, index: number) {
  const { t } = i18n;
  const item = binding.item(index);
  if (action === 'previous') return <Button key={action} label={t('player.previous')} disabled={player.previous.value === -1} {...item} testId="player-previous" />;
  if (action === 'tracks') return <Button key={action} label={t('player.tracks')} {...item} testId="player-tracks" />;
  if (action === 'stats') return <Button key={action} label={t('player.streamInfo')} {...item} testId="player-stats" />;
  return <Button key={action} label={t('player.picture', { mode: t(PICTURE_TEXT[player.picture.value]) })} {...item} testId="player-picture" />;
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
  /** The programme playing from the archive (step 25a), in place of the live now/next. */
  readonly archive: ArchiveProgramme | null;
  /** The movie playing (step 26c), in place of the channel. */
  readonly movie: PlayingMovie | null;
}

function InfoBar({ live, player, i18n, screen, binding, row, guide, archive, movie }: InfoBarProps) {
  const { t } = i18n;
  const clock = live.clock.value;
  const now = guide === undefined ? null : guide.now;
  const next = guide === undefined ? null : guide.next;
  const progress = now === null || now.end <= now.start ? 0 : (clock - now.start * MINUTE_MS) / ((now.end - now.start) * MINUTE_MS);
  const actions = useZone(binding, screen, 'actions');
  const seek = useZone(binding, screen, 'seek');
  const buttons = [];
  const shown = player.actions.value;
  for (let i = 0; i < shown.length; i += 1) buttons.push(actionButton(player, i18n, shown[i]!, actions, i));
  if (movie !== null) {
    return (
      <section class="player__bar" data-testid="player-bar">
        <div class="player__head">
          <span class="player__name" dir="auto" translate={false} data-testid="player-name">
            {movie.item.name}
          </span>
          <span class="player__clock">{i18n.time(new Date(clock))}</span>
        </div>
        <SeekBar player={player} i18n={i18n} span={{ start: 0, length: movie.lengthMs }} movie {...seek.item(0)} state={seek.state(0)} />
        <div class="player__actions">{buttons}</div>
      </section>
    );
  }
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
      {archive !== null ? (
        <div class="player__now" data-testid="player-archive">
          <span class="player__time">
            {i18n.date(new Date(archive.start * MINUTE_MS), 'day')} · {span(i18n, archive)}
          </span>
          <span class="player__title" dir="auto" translate={false}>
            {archive.title === '' ? t('guide.noInfo') : archive.title}
          </span>
        </div>
      ) : now !== null ? (
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
      {archive !== null && <SeekBar player={player} i18n={i18n} span={archiveSpan(archive)} movie={false} {...seek.item(0)} state={seek.state(0)} />}
      {archive === null && next !== null && (
        <div class="player__next" data-testid="player-next">
          <span class="player__time">
            {t('guide.next')} · {i18n.time(new Date(next.start * MINUTE_MS))}
          </span>
          <span class="player__title" dir="auto" translate={false}>
            {next.title}
          </span>
        </div>
      )}
      <div class="player__actions">{buttons}</div>
    </section>
  );
}

function ErrorCard({ failure, i18n, screen, binding, movie }: { failure: PlaybackFailure; i18n: AppI18n; screen: Screen; binding: FocusBinding; movie: boolean }) {
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
        <Button label={t(movie ? 'movie.back' : 'player.channels')} {...buttons.item(1)} testId="player-close" />
      </div>
    </section>
  );
}

/** A catch-up's end (step 25d): "The programme has ended", with "Watch live" and "Back to the guide". */
function EndCard({ archive, i18n, screen, binding }: { archive: ArchiveProgramme; i18n: AppI18n; screen: Screen; binding: FocusBinding }) {
  const { t } = i18n;
  const buttons = useZone(binding, screen, 'card');
  return (
    <section class="player__card" role="alertdialog" data-testid="player-ended">
      <h2 class="player__card-title">{t('player.ended')}</h2>
      <p class="player__card-text" dir="auto" translate={false}>
        {archive.title === '' ? t('guide.noInfo') : archive.title}
      </p>
      <div class="player__card-buttons">
        <Button label={t('player.watchLive')} variant="primary" {...buttons.item(0)} testId="player-live" />
        <Button label={t('player.toGuide')} {...buttons.item(1)} testId="player-guide" />
      </div>
    </section>
  );
}

/** A movie's end (step 26c): "The movie has ended", with "Back" to its details. */
function MovieEndCard({ movie, i18n, screen, binding }: { movie: PlayingMovie; i18n: AppI18n; screen: Screen; binding: FocusBinding }) {
  const { t } = i18n;
  const buttons = useZone(binding, screen, 'card');
  return (
    <section class="player__card" role="alertdialog" data-testid="player-ended">
      <h2 class="player__card-title">{t('player.movieEnded')}</h2>
      <p class="player__card-text" dir="auto" translate={false}>
        {movie.item.name}
      </p>
      <div class="player__card-buttons">
        <Button label={t('movie.back')} variant="primary" {...buttons.item(0)} testId="player-movie-back" />
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
 * The picture's mode (step 20c2b) is on the info bar's fourth button. In 4:3 the screen draws the
 * black side bars itself, under everything else: outside its 4:3 box the `<video>` leaves the
 * stage transparent, and so the page's own colour would show (AVPlay's plane is black there).
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
  const movie = player.movie.value;
  // A zap that waits hides the old channel's card and spinner: the bar shows the new one. A movie (step 26c) has no zaps.
  const current = movie !== null || target === playing;
  const failure = current && status.state === 'failed' ? status.failure : null;
  const ended = current && status.state === 'ended';
  const row = player.row(target);
  const guide = row === null ? undefined : live.guide(row.item.key);
  // A zap that waits shows the new channel live.
  const archive = current ? player.archive.value : null;
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
      data-picture={player.picture.value}
      data-archive={archive === null ? '' : archive.start}
      data-movie={movie === null ? '' : movie.item.key}
      data-length={movie === null || movie.lengthMs === null ? '' : movie.lengthMs}
    >
      {player.picture.value === '4:3' && (
        <div class="player__pillars" aria-hidden="true" data-testid="player-pillars">
          <div class="player__pillar player__pillar--left" />
          <div class="player__pillar player__pillar--right" />
        </div>
      )}
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
        {screen !== null && menu === null && player.info.value && <InfoBar live={live} player={player} i18n={i18n} screen={screen} binding={binding} row={row} guide={guide} archive={archive} movie={movie} />}
      </div>
      {menu !== null && <TrackMenuPanel menu={player.menu} tracks={status.tracks} feed={subtitles.feed} i18n={i18n} screen={menu} binding={binding} />}
      {screen !== null && failure !== null && <ErrorCard failure={failure} i18n={i18n} screen={screen} binding={binding} movie={movie !== null} />}
      {screen !== null && ended && archive !== null && <EndCard archive={archive} i18n={i18n} screen={screen} binding={binding} />}
      {screen !== null && ended && movie !== null && <MovieEndCard movie={movie} i18n={i18n} screen={screen} binding={binding} />}
    </main>
  );
}
