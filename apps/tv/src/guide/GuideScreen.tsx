import type { Focus, FocusBinding } from '@zoma/ui';
import { GuideGrid, guideCellAt } from '@zoma/ui';
import type { AppI18n } from '../i18n';
import type { Guide } from './guide-state';
import { GUIDE_GRID } from './guide-state';
import './guide.css';

const MINUTE_MS = 60_000;

/** What the header says of the focused cell: its programme's title (`null`: none) and its own times. */
export interface GuideDetails {
  readonly title: string | null;
  readonly from: number;
  readonly to: number;
}

/**
 * The focused cell's programme with its own start and end (a cell can be cut by the range or
 * the next start); a placeholder gives its cell's times and no title.
 */
export function guideDetails(guide: Guide, focus: Pick<Focus, 'index' | 'time'>, now: number): GuideDetails {
  const programmes = guide.schedule(focus.index);
  const cell = guideCellAt(programmes, guide.zone(), focus.time ?? now);
  const p = cell === null ? -1 : cell.programme;
  if (p >= 0 && programmes !== null) return { title: programmes.title[p] ?? '', from: programmes.start[p] ?? 0, to: programmes.end[p] ?? 0 };
  return { title: null, from: cell?.start ?? 0, to: cell?.end ?? 0 };
}

interface Props {
  readonly guide: Guide;
  readonly i18n: AppI18n;
  readonly binding: FocusBinding;
  readonly focus: Focus;
  /** The live screen's clock at its last minute tick (ms): the now line, what is on air. */
  readonly clock: number;
  /** The live list's version: the channels' names come from its chunks. */
  readonly listVersion: number;
}

/**
 * The guide screen (RELAY step 23c), painted instead of the live screen while it is on top of
 * the live navigator: a header with the title, the focused channel and the clock, a line with
 * the focused programme and its times, then the grid. Channel names and titles are the
 * provider's data (`dir="auto"`, `translate=false`); the times follow the page's direction.
 */
export function GuideScreen({ guide, i18n, binding, focus, clock, listVersion }: Props) {
  const { t } = i18n;
  const screen = guide.screen.value;
  if (screen === null) return null;
  // Read here so the grid draws again when programmes arrive (its props are new functions then).
  const version = guide.version.value;
  const now = Math.floor(clock / MINUTE_MS);
  const time = (minute: number): string => i18n.time(new Date(minute * MINUTE_MS));
  const onGrid = focus.screen === screen.id;
  const details = onGrid ? guideDetails(guide, focus, now) : null;
  const head = onGrid ? guide.channel(focus.index) : null;

  return (
    <main
      class="guide"
      data-testid="guide-screen"
      data-ready="true"
      data-language={i18n.locale.pseudo ? 'pseudo' : i18n.locale.language}
      data-pending={guide.pending.value}
      data-version={version}
      data-list-version={listVersion}
      data-screen={focus.screen}
      data-zone={focus.zone}
      data-index={focus.index}
      data-time={focus.time ?? ''}
      data-pointer={String(focus.pointer)}
      data-dir={focus.dir}
    >
      <header class="guide__header">
        <div class="guide__top">
          <h1 class="guide__title">{t('guide.title')}</h1>
          <p class="guide__channel" data-testid="guide-channel">
            {head !== null && head.number !== undefined && <span class="guide__number">{head.number}</span>}
            {head !== null && (
              <span class="guide__name" dir="auto" translate={false}>
                {head.name}
              </span>
            )}
          </p>
          <p class="guide__clock" data-testid="guide-clock">
            {i18n.time(new Date(clock))}
          </p>
        </div>
        <p class="guide__details" data-testid="guide-details">
          {details !== null &&
            (details.title === null ? (
              <span class="guide__what">{t('guide.noInfo')}</span>
            ) : (
              <span class="guide__what" dir="auto" translate={false}>
                {details.title}
              </span>
            ))}
          {/* In the page's direction, as the player's info bar: in Arabic the start is on the right, read first. */}
          {details !== null && <span class="guide__when" data-testid="guide-when">{`${time(details.from)} – ${time(details.to)}`}</span>}
        </p>
      </header>
      <GuideGrid
        binding={binding}
        screen={screen}
        zone={GUIDE_GRID}
        channel={(row) => guide.channel(row)}
        schedule={(row) => guide.schedule(row)}
        now={now}
        formatTime={time}
        formatDay={(minute) => i18n.date(new Date(minute * MINUTE_MS), 'day')}
        placeholder={t('guide.noInfo')}
        testId="guide"
      />
    </main>
  );
}
