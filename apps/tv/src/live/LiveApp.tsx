import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { EpgNowNext } from '@zoma/data';
import type { Platform } from '@zoma/platform-api';
import type { ItemBinding, Language, ProgrammeLine } from '@zoma/ui';
import { Badge, Button, Chip, Dialog, LAYOUT, ListRow, Spinner, VirtualList, connectRemote, resolveLocale, useFocus, useZone } from '@zoma/ui';
import { GuideScreen } from '../guide/GuideScreen';
import type { Guide } from '../guide/guide-state';
import { GUIDE_SCREEN } from '../guide/guide-state';
import { DETAILS_SCREEN } from '../guide/programme-details';
import type { AppI18n } from '../i18n';
import { appI18n, switchedTag } from '../i18n';
import type { Player } from '../player/player-state';
import { PlayerScreen } from '../player/PlayerScreen';
import { SettingsScreen } from '../settings/SettingsScreen';
import type { Settings } from '../settings/settings-state';
import { SETTINGS_SCREENS } from '../settings/settings-state';
import type { Live, LiveRow, RailEntry } from './live-state';
import { HEADER_GUIDE, HEADER_SETTINGS, LIVE } from './live-state';
import './live.css';

const MINUTE_MS = 60_000;

/** A programme on a row: its title, its start in the locale's time, and how far it is (now only). */
function line(i18n: AppI18n, programme: EpgNowNext['now'], clock: number, withProgress: boolean): ProgrammeLine | undefined {
  if (programme === null) return undefined;
  const start = programme.start * MINUTE_MS;
  const end = programme.end * MINUTE_MS;
  const progress = withProgress && end > start ? Math.min(1, Math.max(0, (clock - start) / (end - start))) : undefined;
  return { title: programme.title, time: i18n.time(new Date(start)), progress };
}

function ChannelRow({ live, i18n, index, row, item }: { live: Live; i18n: AppI18n; index: number; row: LiveRow | null; item: ItemBinding }) {
  const { t } = i18n;
  if (row === null) return <ListRow name="" {...item} testId={`row-${index}`} />;
  const guide = live.guide(row.item.key);
  const clock = live.clock.value;
  const badges = [];
  if (row.item.catchup !== null) badges.push(<Badge key="catchup" label={t('badge.catchUp')} />);
  if (row.item.radio) badges.push(<Badge key="radio" label={t('badge.radio')} />);
  const now = guide === undefined ? undefined : line(i18n, guide.now, clock, true);
  const next = guide === undefined ? undefined : line(i18n, guide.next, clock, false);
  return (
    <ListRow
      number={row.number}
      name={row.item.name}
      now={now}
      next={next}
      nextLabel={t('guide.next')}
      placeholder={guide === undefined ? undefined : t('guide.none')}
      badges={badges.length > 0 ? badges : undefined}
      {...item}
      testId={`row-${index}`}
    />
  );
}

/** A rail entry's label: ours for "All channels" and a group without a name, else the provider's. */
function entryLabel(entry: RailEntry, t: AppI18n['t']): { label: string; data: boolean } {
  if (entry.kind === 'all') return { label: t('category.all'), data: false };
  if (entry.name === '') return { label: t('live.noGroup'), data: false };
  return { label: entry.name, data: true };
}

function LiveScreen({ live, i18n, player, settings, guide }: { live: Live; i18n: AppI18n; player: Player | null; settings: Settings | null; guide: Guide | null }) {
  const { t } = i18n;
  const { binding, home } = live;
  const focus = useFocus(binding);
  // The player covers the live screen (step 20a), its track menu too (20b): only their own parts paint, over the stage.
  if ((focus.screen === 'player' || focus.screen === 'tracks') && player !== null) return <PlayerScreen live={live} player={player} i18n={i18n} />;
  // The settings screens (step 22b2) paint instead of the live screen.
  if (settings !== null && SETTINGS_SCREENS.indexOf(focus.screen) !== -1) return <SettingsScreen settings={settings} i18n={i18n} binding={binding} focus={focus} />;
  // The guide (step 23c) paints instead of the live screen, with its programme details (24a) over it; the player opens over it.
  if (guide !== null && (focus.screen === GUIDE_SCREEN || focus.screen === DETAILS_SCREEN)) return <GuideScreen guide={guide} i18n={i18n} binding={binding} focus={focus} clock={live.clock.value} listVersion={live.version.value} />;
  const status = live.status.value;
  const entries = live.rail.value;
  const shown = live.category.value;
  const entry = entries[shown];
  const selected = live.selected.value;
  // Read here so that the rows render again when chunks or now/next arrive.
  const version = live.version.value;
  const retry = useZone(binding, home, 'retry');
  const header = useZone(binding, home, 'header');
  const dialog = focus.screen === 'exit' ? useZone(binding, binding.nav.top, 'buttons') : null;
  const heading = entry === undefined ? null : entryLabel(entry, t);

  return (
    <main
      class="live"
      data-testid="live"
      data-ready={status === 'loading' ? 'false' : 'true'}
      data-status={status}
      data-pending={live.pending.value}
      data-version={version}
      data-category={shown}
      data-selected={selected ?? ''}
      data-language={i18n.locale.pseudo ? 'pseudo' : i18n.locale.language}
      data-screen={focus.screen}
      data-zone={focus.zone}
      data-index={focus.index}
      data-pointer={String(focus.pointer)}
      data-dir={focus.dir}
    >
      <header class="live__header">
        <h1 class="live__title">{t('live.title')}</h1>
        <p class="live__meta" data-testid="live-meta">
          {heading !== null && entry !== undefined && (
            <span>
              <span class="live__category" dir={heading.data ? 'auto' : undefined} translate={heading.data ? false : undefined}>
                {heading.label}
              </span>
              {' · '}
              <span data-n={entry.count}>{t('live.channels', { n: entry.count })}</span>
            </span>
          )}
        </p>
        <p class="live__clock" data-testid="live-clock">
          {i18n.time(new Date(live.clock.value))}
        </p>
        <div class="live__end">
          <Button label={t('guide.open')} {...header.item(HEADER_GUIDE)} testId="live-guide" />
          <Button label={t('settings.open')} {...header.item(HEADER_SETTINGS)} testId="live-settings" />
        </div>
      </header>

      {status === 'loading' && (
        <div class="live__message">
          <Spinner size="l" label={t('live.loading')} testId="live-spinner" />
        </div>
      )}
      {status === 'empty' && (
        <div class="live__message" data-testid="live-empty">
          <p class="live__text">{t('live.empty')}</p>
        </div>
      )}
      {status === 'failed' && (
        <div class="live__message" data-testid="live-failed">
          <p class="live__text">{t('live.failed')}</p>
          <Button label={t('live.retry')} variant="primary" {...retry.item(0)} testId="live-retry" />
        </div>
      )}
      {status === 'ready' && (
        <div class="live__body">
          <VirtualList
            binding={binding}
            screen={home}
            zone="rail"
            itemSize={LAYOUT.railHeight}
            gap={LIVE.railGap}
            class="live__rail"
            testId="rail"
            renderItem={(i, item) => {
              const at = entries[i];
              if (at === undefined) return null;
              const { label, data } = entryLabel(at, t);
              return <Chip label={label} data={data} selected={i === shown} count={i18n.number(at.count)} {...item} testId={`chip-${i}`} />;
            }}
          />
          <VirtualList
            binding={binding}
            screen={home}
            zone="channels"
            gap={LIVE.rowGap}
            class="live__channels"
            testId="channels"
            renderItem={(i, item) => <ChannelRow live={live} i18n={i18n} index={i} row={live.row(i)} item={item} />}
          />
        </div>
      )}

      {dialog !== null && (
        <Dialog title={t('exit.title')} message={t('exit.message')} testId="exit-dialog">
          <Button label={t('exit.stay')} {...dialog.item(0)} testId="dialog-0" />
          <Button label={t('exit.confirm')} {...dialog.item(1)} testId="dialog-1" />
        </Dialog>
      )}
    </main>
  );
}

interface Props {
  readonly platform: Platform;
  readonly live: Live;
  /** The language picked in onboarding (`null`: the TV's). */
  readonly language: Language | null;
  /** The player OK on a channel opens (step 20a; `null`: the row is only marked). */
  readonly player?: Player | null;
  /** The settings the header's button opens (step 22b2; `null`: none paint). */
  readonly settings?: Settings | null;
  /** The guide the header's "Guide" opens (step 23c; `null`: none paints). */
  readonly guide?: Guide | null;
}

/**
 * The live screen in the language picked in onboarding, in the TV's region (the formats keep
 * the region's), or the TV's own when none was picked.
 */
export function LiveApp({ platform, live, language, player = null, settings = null, guide = null }: Props) {
  const i18n = useSignal<AppI18n | null>(null);
  useEffect(() => {
    let closed = false;
    const start = (tag: string, country: string | null): void => {
      if (closed) return;
      const settings = resolveLocale(tag, { country });
      const locale = language === null || language === settings.language ? settings : resolveLocale(switchedTag(settings), { country });
      live.nav.setDir(locale.dir);
      document.documentElement.lang = locale.tag;
      document.documentElement.dir = locale.dir;
      i18n.value = appI18n(locale);
    };
    platform.info().then(
      (info) => start(info.locale, info.country),
      () => start('en-US', null),
    );
    const disconnect = connectRemote({ platform, nav: live.nav, target: window, onIntent: () => live.activity() });
    return () => {
      closed = true;
      disconnect();
    };
  }, [platform, live, language]);

  if (i18n.value === null) {
    return (
      <main class="live is-loading" data-testid="live" data-ready="false">
        <Spinner size="l" />
      </main>
    );
  }
  return <LiveScreen live={live} i18n={i18n.value} player={player} settings={settings} guide={guide} />;
}
