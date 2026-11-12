import type { CatalogItem } from '@lablo/core';
import type { Focus, FocusBinding, ItemBinding } from '@lablo/ui';
import { Spinner, TextField, VirtualList, useZone } from '@lablo/ui';
import type { AppI18n } from '../i18n';
import type { Search } from './search-state';
import { SEARCH, SEARCH_FIELD, SEARCH_FIELD_ID, SEARCH_RESULTS } from './search-state';
import './search.css';

/**
 * The search screen (RELAY step 28a), painted instead of the live screen while it is on top of
 * the live navigator: the header with the count found, the search field, then the results, each
 * the item's name over its kind and group. Names and groups are data (`dir=auto`,
 * `translate=false`); a group the provider didn't name gets our own words.
 */

/** A row's kind in words: a playlist's series line is one episode (it has its own URL). */
export function kindText(t: AppI18n['t'], item: CatalogItem): string {
  if (item.kind === 'live') return t('search.live');
  if (item.kind === 'movie') return t('search.movie');
  return item.url === '' ? t('search.series') : t('search.episode');
}

/** A row's group: the provider's, else our words for a group without a name. */
export function groupText(t: AppI18n['t'], item: CatalogItem): { readonly text: string; readonly data: boolean } {
  if (item.group !== '') return { text: item.group, data: true };
  if (item.kind === 'live') return { text: t('live.noGroup'), data: false };
  return { text: item.kind === 'movie' ? t('movies.noGroup') : t('series.noGroup'), data: false };
}

/** The line under the field: what to type, or why nothing is listed. */
export function searchHint(i18n: AppI18n, search: Pick<Search, 'status' | 'count'>): string {
  return search.status.value === 'ready' && search.count.value === 0 ? i18n.t('search.none') : i18n.t('search.hint');
}

/** The header's count: every match, or the best listed of them all. */
export function countText(i18n: AppI18n, search: Pick<Search, 'count' | 'total'>): string {
  const listed = search.count.value;
  const total = search.total.value;
  return listed < total ? i18n.t('search.more', { n: listed, total }) : i18n.t('search.count', { n: total });
}

function rowClass(item: ItemBinding): string {
  const state = item.state === 'focused' ? ' is-focused' : item.state === 'memory' ? ' is-memory' : '';
  return `search__row${state}`;
}

export function SearchRow({ i18n, search, index, item }: { i18n: AppI18n; search: Search; index: number; item: ItemBinding }) {
  const { t } = i18n;
  const found = search.row(index);
  const group = found === null ? null : groupText(t, found);
  return (
    <div
      class={rowClass(item)}
      role="option"
      data-testid={`result-${index}`}
      data-state={item.state}
      data-kind={found === null ? '' : found.kind}
      data-key={found === null ? '' : found.key}
      onMouseMove={item.onHover}
      onClick={item.onPress}
    >
      {found !== null && group !== null && (
        <span class="search__text">
          <span class="search__name" dir="auto" translate={false}>
            {found.name}
          </span>
          <span class="search__where">
            <span class="search__kind">{kindText(t, found)}</span>
            {' · '}
            <span class="search__group" dir={group.data ? 'auto' : undefined} translate={group.data ? false : undefined}>
              {group.text}
            </span>
          </span>
        </span>
      )}
    </div>
  );
}

interface Props {
  readonly search: Search;
  readonly i18n: AppI18n;
  readonly binding: FocusBinding;
  readonly focus: Focus;
}

export function SearchScreen({ search, i18n, binding, focus }: Props) {
  const { t } = i18n;
  const screen = search.screen.value;
  if (screen === null) return null;
  const field = useZone(binding, screen, SEARCH_FIELD);
  const status = search.status.value;
  const count = search.count.value;
  const query = search.query.value;
  // (Read so that new rows draw the list again: the rows come from `row()`.)
  const drawn = search.drawn.value;
  return (
    <main
      class="search"
      data-testid="search-screen"
      data-ready="true"
      data-language={i18n.locale.pseudo ? 'pseudo' : i18n.locale.language}
      data-status={status}
      data-answered={search.answered.value}
      data-count={count}
      data-total={search.total.value}
      data-drawn={drawn}
      data-pending={search.pending.value}
      data-editing={search.editor.editing.value ?? ''}
      data-screen={focus.screen}
      data-zone={focus.zone}
      data-index={focus.index}
      data-pointer={String(focus.pointer)}
      data-dir={focus.dir}
    >
      <header class="search__header">
        <h1 class="search__title">{t('search.title')}</h1>
        {status === 'searching' && <Spinner size="s" testId="search-spinner" />}
        {status === 'ready' && (
          <span class="search__count" data-testid="search-count" data-n={search.total.value}>
            {countText(i18n, search)}
          </span>
        )}
      </header>
      <div class="search__field">
        <TextField
          id={SEARCH_FIELD_ID}
          label={t('search.field')}
          value={query}
          hint={searchHint(i18n, search)}
          error={status === 'failed' ? t('search.failed') : null}
          onValue={(value) => search.setQuery(value)}
          edit={search.editor.field(SEARCH_FIELD_ID)}
          {...field.item(0)}
          testId="search-field"
        />
      </div>
      {count > 0 && (
        <VirtualList
          binding={binding}
          screen={screen}
          zone={SEARCH_RESULTS}
          itemSize={SEARCH.rowHeight}
          gap={SEARCH.rowGap}
          class="search__list"
          testId="search-results"
          renderItem={(i, item) => <SearchRow i18n={i18n} search={search} index={i} item={item} />}
        />
      )}
    </main>
  );
}
