import type { FocusBinding } from '@zoma/ui';
import { Button, Dialog, Spinner, useZone } from '@zoma/ui';
import type { AppI18n, MessageKey } from '../i18n';
import type { DetailsAction, Details, DetailsShown } from './programme-details';
import { DETAILS_ACTIONS, detailsActions } from './programme-details';

const MINUTE_MS = 60_000;

/** Each button's text and test id; the first one is the primary. */
const ACTION_TEXT: Readonly<Record<DetailsAction, readonly [MessageKey, string]>> = {
  archive: ['details.archive', 'programme-archive'],
  watch: ['details.watch', 'programme-watch'],
  map: ['details.mapping', 'programme-map'],
  close: ['details.close', 'programme-close'],
};

/** The texts of the dialog's lines that come from the guide (`''`: the guide has none). */
export interface DetailsLines {
  readonly sub: string;
  readonly category: string;
  readonly episode: string;
  readonly desc: string;
}

/** The read programme's lines, trimmed (all empty until it is read). */
export function detailsLines(shown: DetailsShown): DetailsLines {
  const p = shown.programme;
  if (p === null) return { sub: '', category: '', episode: '', desc: '' };
  return { sub: p.sub.trim(), category: p.category.trim(), episode: p.episode.trim(), desc: p.desc.trim() };
}

interface Props {
  readonly details: Details;
  readonly i18n: AppI18n;
  readonly binding: FocusBinding;
}

/**
 * The programme details (RELAY step 24a) over the guide screen: the title, the channel, the day,
 * times and length (the grid's), then the sub-title, the category and episode, and the
 * description as the guide gives them. The guide's texts are the provider's data (`dir="auto"`,
 * `translate=false`); the times follow the page's direction, as in the guide's header.
 */
export function ProgrammeDialog({ details, i18n, binding }: Props) {
  const { t } = i18n;
  const shown = details.shown.value;
  if (shown === null) return null;
  const actions = useZone(binding, binding.nav.top, DETAILS_ACTIONS);
  const { target, status } = shown;
  const lines = detailsLines(shown);
  const time = (minute: number): string => i18n.time(new Date(minute * MINUTE_MS));
  const tags = [lines.category, lines.episode].filter((text) => text !== '');
  const body = (
    <div class="details" data-testid="programme-body" data-status={status}>
      <p class="details__channel" data-testid="programme-channel">
        {target.channel.number !== undefined && <span class="details__number">{target.channel.number}</span>}
        <span class="details__name" dir="auto" translate={false}>
          {target.channel.name}
        </span>
      </p>
      {lines.sub !== '' && (
        <p class="details__sub" dir="auto" translate={false} data-testid="programme-sub">
          {lines.sub}
        </p>
      )}
      <p class="details__when" data-testid="programme-when">
        <span class="details__day">{i18n.date(new Date(target.start * MINUTE_MS), 'day')}</span>
        <span class="details__times">{`${time(target.start)} – ${time(target.end)}`}</span>
        <span class="details__length" data-n={target.end - target.start}>
          {t('details.length', { n: target.end - target.start })}
        </span>
      </p>
      {tags.length > 0 && (
        <p class="details__tags" data-testid="programme-tags">
          {tags.map((text, i) => (
            <span key={i} class="details__tag" dir="auto" translate={false}>
              {text}
            </span>
          ))}
        </p>
      )}
      {status === 'reading' && (
        <div class="details__reading">
          <Spinner size="s" testId="programme-spinner" />
        </div>
      )}
      {/* (Only a read programme has a description.) */}
      {lines.desc !== '' && (
        <p class="details__desc" dir="auto" translate={false} data-testid="programme-desc">
          {lines.desc}
        </p>
      )}
      {status === 'read' && lines.desc === '' && (
        <p class="details__note" data-testid="programme-note">
          {t('details.noDescription')}
        </p>
      )}
      {status === 'failed' && (
        <p class="details__note" data-testid="programme-note">
          {t('details.failed')}
        </p>
      )}
    </div>
  );
  const buttons = detailsActions(target.archive === true);
  return (
    <Dialog title={target.title === '' ? t('guide.noInfo') : target.title} data={target.title !== ''} body={body} wide testId="programme">
      {buttons.map((action, i) => {
        const [label, testId] = ACTION_TEXT[action];
        return <Button key={action} label={t(label)} variant={i === 0 ? 'primary' : 'secondary'} {...actions.item(i)} testId={testId} />;
      })}
    </Dialog>
  );
}
