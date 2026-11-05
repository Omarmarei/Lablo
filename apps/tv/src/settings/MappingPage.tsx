import type { FocusBinding, ItemBinding } from '@zoma/ui';
import { Spinner, TextField, VirtualList, useZone } from '@zoma/ui';
import type { AppI18n } from '../i18n';
import type { Mapping, MappingCurrent, MappingRow } from './mapping-state';
import { MAPPING, MAPPING_CHANNELS, MAPPING_SEARCH, SEARCH_FIELD_ID } from './mapping-state';
import './mapping.css';

/**
 * The manual mapping's picker (RELAY step 24e), painted instead of the live screen while it is on
 * top of the live navigator: the header with the count found, a line naming the live channel and
 * its current guide channel, the search field, then "No guide", "Match automatically" (for a
 * channel with a mapping) and the guides' channels, the current one checked. The channels' names,
 * ids and links are data (`dir`, `translate=false`); the live channel's name is an argument.
 */

const CHECK = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
  </svg>
);

function rowClass(item: ItemBinding, marked: boolean): string {
  const state = item.state === 'focused' ? ' is-focused' : item.state === 'memory' ? ' is-memory' : '';
  return `mapping__row${state}${marked ? ' is-selected' : ''}`;
}

/** Where the channel's programmes come from now, in words (`name`: the guide channel's, or `''` for its id). */
export function currentText(i18n: AppI18n, current: MappingCurrent | null, name: string): string {
  if (current === null) return '';
  if (current.kind === 'none') return i18n.t('mapping.nowNone');
  if (current.kind === 'off') return i18n.t('mapping.nowOff');
  const shown = name === '' ? current.channel : name;
  return current.kind === 'pin' ? i18n.t('mapping.nowPin', { name: shown }) : i18n.t('mapping.nowAuto', { name: shown });
}

/** The line under the search field: why nothing is listed, or what to type. */
export function searchHint(i18n: AppI18n, mapping: Pick<Mapping, 'status' | 'count' | 'query'>): string {
  if (mapping.status.value !== 'ready' || mapping.count.value > 0) return i18n.t('mapping.searchHint');
  return mapping.query.value.trim() === '' ? i18n.t('mapping.empty') : i18n.t('mapping.none');
}

function RowText({ i18n, mapping, row }: { i18n: AppI18n; mapping: Mapping; row: MappingRow }) {
  const { t } = i18n;
  if (row.kind !== 'channel') {
    return (
      <span class="mapping__text">
        <span class="mapping__name">{row.kind === 'off' ? t('mapping.off') : t('mapping.auto')}</span>
        <span class="mapping__where">{row.kind === 'off' ? t('mapping.offHint') : t('mapping.autoHint')}</span>
      </span>
    );
  }
  const { channel } = row;
  const link = mapping.link(channel.epgSrc);
  return (
    <span class="mapping__text">
      <span class="mapping__name" dir="auto" translate={false}>
        {channel.name}
      </span>
      <span class="mapping__where">
        <span class="mapping__id" dir="ltr" translate={false}>
          {channel.id}
        </span>
        {link !== '' && ' · '}
        {link !== '' && (
          <span class="mapping__link" dir="ltr" translate={false}>
            {link}
          </span>
        )}
      </span>
    </span>
  );
}

export function MappingItem({ i18n, mapping, index, item }: { i18n: AppI18n; mapping: Mapping; index: number; item: ItemBinding }) {
  const row = mapping.row(index);
  const marked = row !== null && mapping.marked(row);
  const channel = row !== null && row.kind === 'channel' ? row.channel : null;
  return (
    <div
      class={rowClass(item, marked)}
      role="option"
      aria-selected={marked ? 'true' : 'false'}
      data-testid={`mapping-${index}`}
      data-state={item.state}
      data-kind={row === null ? '' : row.kind}
      data-src={channel === null ? '' : channel.epgSrc}
      data-id={channel === null ? '' : channel.id}
      data-selected={String(marked)}
      onMouseMove={item.onHover}
      onClick={item.onPress}
    >
      <span class="mapping__check">{marked && CHECK}</span>
      {row !== null && <RowText i18n={i18n} mapping={mapping} row={row} />}
    </div>
  );
}

/** "Reading the guides…" while a mapping's refresh runs (`reading` > 0): the list without a guide and the guide screen show it. */
export function MappingReading({ i18n, reading, testId }: { i18n: AppI18n; reading: number; testId: string }) {
  if (reading === 0) return null;
  return (
    <p class="mapping__reading" data-testid={testId}>
      <Spinner size="s" />
      <span>{i18n.t('mapping.reading')}</span>
    </p>
  );
}

/** The picker: what it maps, the search, and the rows read a page at a time. */
export function MappingPage({ i18n, binding, mapping }: { i18n: AppI18n; binding: FocusBinding; mapping: Mapping }) {
  const { t } = i18n;
  const screen = mapping.screen.value;
  const target = mapping.target.value;
  if (screen === null || target === null) return null;
  const search = useZone(binding, screen, MAPPING_SEARCH);
  const status = mapping.status.value;
  const current = mapping.current.value;
  const count = mapping.count.value;
  const query = mapping.query.value;
  // (Read so that new rows draw the list again: the rows come from `row()`.)
  const drawn = mapping.drawn.value;
  return (
    <div class="settings__page" data-testid="mapping" data-status={status} data-count={count} data-drawn={drawn} data-current={current === null ? '' : current.kind}>
      <header class="settings__header">
        <h1 class="settings__title">{t('mapping.title')}</h1>
        {status === 'loading' && <Spinner size="s" testId="mapping-spinner" />}
        {status === 'ready' && (
          <span class="unmatched__count" data-testid="mapping-count" data-n={count}>
            {t('live.channels', { n: count })}
          </span>
        )}
      </header>
      <p class="guides__intro" data-testid="mapping-intro">
        <span class="mapping__for">{t('mapping.channel', { name: target.name })}</span>
        {current !== null && ' · '}
        {current !== null && (
          <span class="mapping__now" data-testid="mapping-now">
            {currentText(i18n, current, mapping.currentName.value)}
          </span>
        )}
      </p>
      <div class="mapping__search">
        <TextField
          id={SEARCH_FIELD_ID}
          label={t('mapping.search')}
          value={query}
          hint={searchHint(i18n, mapping)}
          error={status === 'failed' ? t('mapping.failed') : null}
          onValue={(value) => mapping.setQuery(value)}
          edit={mapping.editor.field(SEARCH_FIELD_ID)}
          {...search.item(0)}
          testId="mapping-search"
        />
      </div>
      {mapping.fixed() > 0 && (
        <VirtualList
          binding={binding}
          screen={screen}
          zone={MAPPING_CHANNELS}
          itemSize={MAPPING.rowHeight}
          gap={MAPPING.rowGap}
          class="mapping__list"
          testId="mapping-list"
          renderItem={(i, item) => <MappingItem i18n={i18n} mapping={mapping} index={i} item={item} />}
        />
      )}
    </div>
  );
}
