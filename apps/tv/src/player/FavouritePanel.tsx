import type { VNode } from 'preact';
import type { FavouriteList } from '@lablo/data/client';
import { LIST_NAME_MAX } from '@lablo/data/client';
import type { FocusBinding, ItemBinding, Screen } from '@lablo/ui';
import { Button, Dialog, TextField, useZone } from '@lablo/ui';
import type { AppI18n } from '../i18n';
import type { FavouriteMenu } from './favourite-menu';
import { LIST_NAME_FIELD, NEW_CANCEL, NEW_CREATE, PANEL_ROWS } from './favourite-menu';

/** The star of the info bar's "Favourites" (step 35c), ours: filled when the channel is in a list. */
export function star(filled: boolean): VNode {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        stroke-width="2"
        stroke-linejoin="round"
      />
    </svg>
  );
}

const CHECK = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
  </svg>
);

/** A list's name: the user's, else the catalog's "Favourites". */
export function listName(i18n: AppI18n, list: Pick<FavouriteList, 'name'>): { readonly text: string; readonly own: boolean } {
  return list.name === null ? { text: i18n.t('category.favourites'), own: false } : { text: list.name, own: true };
}

function Row({ item, name, own, checked, testId }: { item: ItemBinding; name: string; own: boolean; checked: boolean | null; testId: string }) {
  const state = item.state;
  return (
    <div
      class={`tracks__row${checked === true ? ' is-selected' : ''}${state === 'focused' ? ' is-focused' : state === 'memory' ? ' is-memory' : ''}`}
      role={checked === null ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={checked === null ? undefined : checked ? 'true' : 'false'}
      data-testid={testId}
      data-state={state}
      data-checked={checked === null ? '' : String(checked)}
      onMouseMove={item.onHover}
      onClick={item.onPress}
    >
      <span class="tracks__check">{checked === true && CHECK}</span>
      <span class="tracks__name favourites__name" dir={own ? 'auto' : undefined} translate={own ? false : undefined}>
        {name}
      </span>
    </div>
  );
}

interface Props {
  readonly menu: FavouriteMenu;
  /** The lists, as a prop: @preact/signals skips a child whose props didn't change. */
  readonly lists: readonly FavouriteList[];
  readonly i18n: AppI18n;
  readonly screen: Screen;
  readonly binding: FocusBinding;
  /** On an opaque surface (step 39b: over the live list, whose rows would show through the scrim). */
  readonly solid?: boolean;
}

/**
 * The favourites panel (RELAY step 35c): at the inline end over the picture, as the track menu
 * is. Each list with its check, then "New list"; with no list yet, "Favourites" first.
 */
export function FavouritePanel({ menu, lists, i18n, screen, binding, solid = false }: Props) {
  const { t } = i18n;
  const view = useZone(binding, screen, 'lists');
  const count = menu.rows();
  const key = menu.item.value?.key ?? '';
  const top = Math.max(0, Math.min(view.position.top, count - PANEL_ROWS));
  const rows: VNode[] = [];
  for (let i = top; i < Math.min(count, top + PANEL_ROWS); i += 1) {
    const list = lists[i];
    if (list !== undefined) {
      const name = listName(i18n, list);
      rows.push(<Row key={list.id} item={view.item(i)} name={name.text} own={name.own} checked={list.keys.indexOf(key) !== -1} testId={`favourites-list-${i}`} />);
    } else if (lists.length === 0 && i === 0) {
      rows.push(<Row key="first" item={view.item(i)} name={t('category.favourites')} own={false} checked={false} testId="favourites-list-0" />);
    } else rows.push(<Row key="new" item={view.item(i)} name={t('favourites.new')} own={false} checked={null} testId="favourites-new" />);
  }
  const problem = menu.problem.value;
  return (
    <aside class={solid ? 'tracks tracks--solid' : 'tracks'} data-testid="favourites" data-pending={menu.pending.value} data-problem={problem ?? ''} data-top={top}>
      <h2 class="tracks__title">{t('favourites.title')}</h2>
      <div class="tracks__list" role="menu">
        {rows}
      </div>
      {problem !== null && (
        <p class="tracks__refused" role="status" data-testid="favourites-problem">
          {t(problem === 'full' ? 'favourites.full' : 'favourites.refused')}
        </p>
      )}
    </aside>
  );
}

/** The new list's form as drawn, hook-free: the name, then "Create list" and "Cancel". */
export function NewListView({ i18n, menu, field, action }: { i18n: AppI18n; menu: FavouriteMenu; field: ItemBinding; action: (index: number) => ItemBinding }) {
  const { t } = i18n;
  return (
    <Dialog title={t('favourites.new')} testId="favourite-new">
      <div class="favourites__form">
        <TextField
          id={LIST_NAME_FIELD}
          label={t('field.name')}
          value={menu.text.value}
          hint={t('favourites.nameHint', { name: t('category.favourites') })}
          maxLength={LIST_NAME_MAX}
          onValue={(value) => menu.setText(value)}
          edit={menu.editor.field(LIST_NAME_FIELD)}
          {...field}
          testId="favourite-new-name"
        />
        <div class="favourites__actions">
          <Button label={t('favourites.create')} variant="primary" {...action(NEW_CREATE)} testId="favourite-new-create" />
          <Button label={t('action.cancel')} {...action(NEW_CANCEL)} testId="favourite-new-cancel" />
        </div>
      </div>
    </Dialog>
  );
}

export function NewListForm({ i18n, menu, binding }: { i18n: AppI18n; menu: FavouriteMenu; binding: FocusBinding }) {
  const screen = binding.nav.top;
  const field = useZone(binding, screen, 'field');
  const actions = useZone(binding, screen, 'actions');
  return <NewListView i18n={i18n} menu={menu} field={field.item(0)} action={(i) => actions.item(i)} />;
}
