import type { VNode } from 'preact';
import { LIST_NAME_MAX } from '@lablo/data/client';
import type { Focus, FocusBinding, ItemBinding, Screen } from '@lablo/ui';
import { Button, Dialog, Spinner, TextField, VirtualList, useZone } from '@lablo/ui';
import type { AppI18n } from '../i18n';
import { listName, star } from '../player/FavouritePanel';
import type { ChannelRow, GroupAction, GroupMenu, GroupRow, Groups, GroupsStatus } from './groups-state';
import { CHANNEL_MENU, DELETE_NO, DELETE_YES, GROUP_DELETE, GROUP_MENU, GROUP_NAME_FIELD, GROUP_RENAME, GROUPS, GROUPS_SCREEN, RENAME_CANCEL, RENAME_SAVE } from './groups-state';

/**
 * Settings › "Channel groups" (RELAY step 35d): the lists and the groups, a list's channels, the
 * row menus, the rename form and the delete question. Lists' and groups' names are data (`dir`,
 * `translate=false`, or isolated arguments); an unnamed list is the catalog's "Favourites", a
 * group without a name its "Other channels".
 */

type Translate = AppI18n['t'];

function rowClass(base: string, item: ItemBinding, moving: boolean): string {
  const state = item.state === 'focused' ? ' is-focused' : item.state === 'memory' ? ' is-memory' : '';
  return `${base}${state}${moving ? ' is-moving' : ''}`;
}

/** A row's name: a list's (or "Favourites"), a group's (or "Other channels"); `own` when it is the user's or the provider's text. */
export function rowName(i18n: AppI18n, row: GroupRow): { readonly text: string; readonly own: boolean } {
  if (row.kind === 'list') return listName(i18n, row.list);
  return row.group.name === '' ? { text: i18n.t('live.noGroup'), own: false } : { text: row.group.name, own: true };
}

/** The line under a row's name: a list's kind and size; a group's source (with two or more), size, and "Hidden". */
export function rowLine(i18n: AppI18n, row: GroupRow): string {
  const { t } = i18n;
  if (row.kind === 'list') return `${t('groups.kindList')} · ${t('live.channels', { n: row.list.keys.length })}`;
  const parts: string[] = [];
  if (row.hidden) parts.push(t('groups.hidden'));
  if (row.source !== '') parts.push(t('guides.from', { name: row.source }));
  parts.push(t('live.channels', { n: row.count }));
  return parts.join(' · ');
}

/** The arrows at the end of a row being moved: UP and DOWN move it. */
const ARROWS = (
  <span class="groups__moving">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2 6 9h12zM12 22l-6-7h12z" />
    </svg>
  </span>
);

function Name({ text, own, testId }: { text: string; own: boolean; testId?: string }) {
  return (
    <span class="groups__name" dir={own ? 'auto' : undefined} translate={own ? false : undefined} data-testid={testId}>
      {text}
    </span>
  );
}

export function GroupItem({ i18n, row, index, moving, item }: { i18n: AppI18n; row: GroupRow; index: number; moving: boolean; item: ItemBinding }) {
  const name = rowName(i18n, row);
  return (
    <div
      class={rowClass(`groups__row groups__row--${row.kind}${row.kind === 'group' && row.hidden ? ' is-hidden' : ''}`, item, moving)}
      role="option"
      aria-selected={item.state === 'focused' ? 'true' : 'false'}
      data-testid={`group-${index}`}
      data-kind={row.kind}
      data-id={row.kind === 'list' ? row.list.id : row.group.name}
      data-hidden={row.kind === 'group' ? String(row.hidden) : ''}
      data-moving={String(moving)}
      data-state={item.state}
      onMouseMove={item.onHover}
      onClick={item.onPress}
    >
      <div class="groups__top">
        {row.kind === 'list' && <span class="groups__star">{star(true)}</span>}
        <Name text={name.text} own={name.own} testId={`group-${index}-name`} />
        {moving && ARROWS}
      </div>
      <span class="groups__line" data-testid={`group-${index}-line`}>
        {rowLine(i18n, row)}
      </span>
    </div>
  );
}

export function ChannelItem({ i18n, row, index, moving, item }: { i18n: AppI18n; row: ChannelRow; index: number; moving: boolean; item: ItemBinding }) {
  return (
    <div
      class={rowClass('groups__row', item, moving)}
      role="option"
      aria-selected={item.state === 'focused' ? 'true' : 'false'}
      data-testid={`group-channel-${index}`}
      data-key={row.key}
      data-found={String(row.item !== null)}
      data-moving={String(moving)}
      data-state={item.state}
      onMouseMove={item.onHover}
      onClick={item.onPress}
    >
      <div class="groups__top">
        <span class="groups__number">{i18n.number(index + 1)}</span>
        <Name text={row.name} own testId={`group-channel-${index}-name`} />
        {moving && ARROWS}
      </div>
      {row.item === null && (
        <span class="groups__line" data-testid={`group-channel-${index}-missing`}>
          {i18n.t('groups.missing')}
        </span>
      )}
    </div>
  );
}

/** The menus' buttons in words. */
export function actionLabels(t: Translate): Record<GroupAction, string> {
  return {
    channels: t('groups.channels'),
    move: t('groups.move'),
    rename: t('groups.rename'),
    delete: t('groups.delete'),
    hide: t('groups.hide'),
    show: t('groups.show'),
    remove: t('guides.remove'),
    cancel: t('action.cancel'),
  };
}

/** A row's menu as drawn, hook-free: the row's name as the title, its actions in a column. */
export function GroupMenuView({ i18n, menu, item }: { i18n: AppI18n; menu: GroupMenu; item: (index: number) => ItemBinding }) {
  const labels = actionLabels(i18n.t);
  const name = menu.row !== null ? rowName(i18n, menu.row) : { text: menu.channel === null ? '' : menu.channel.name, own: true };
  return (
    <Dialog title={name.text} data={name.own} testId="group-menu">
      <div class="guides__menu">
        {menu.actions.map((action, i) => (
          <Button key={action} label={labels[action]} variant={action === 'delete' || action === 'remove' ? 'danger' : 'secondary'} {...item(i)} testId={`group-menu-${action}`} />
        ))}
      </div>
    </Dialog>
  );
}

function MenuDialog({ i18n, binding, menu }: { i18n: AppI18n; binding: FocusBinding; menu: GroupMenu }) {
  const zone = useZone(binding, binding.nav.top, 'actions');
  return <GroupMenuView i18n={i18n} menu={menu} item={(i) => zone.item(i)} />;
}

/** The rename form as drawn, hook-free: the name, then "Save" and "Cancel". */
export function RenameView({ i18n, groups, field, action }: { i18n: AppI18n; groups: Groups; field: ItemBinding; action: (index: number) => ItemBinding }) {
  const { t } = i18n;
  return (
    <Dialog title={t('groups.renameTitle')} testId="group-rename">
      <div class="guides__form">
        <TextField
          id={GROUP_NAME_FIELD}
          label={t('field.name')}
          value={groups.text.value}
          hint={t('favourites.nameHint', { name: t('category.favourites') })}
          maxLength={LIST_NAME_MAX}
          onValue={(value) => groups.setText(value)}
          edit={groups.editor.field(GROUP_NAME_FIELD)}
          {...field}
          testId="group-rename-name"
        />
        <div class="guides__actions">
          <Button label={t('sources.save')} variant="primary" {...action(RENAME_SAVE)} testId="group-rename-save" />
          <Button label={t('action.cancel')} {...action(RENAME_CANCEL)} testId="group-rename-cancel" />
        </div>
      </div>
    </Dialog>
  );
}

function RenameDialog({ i18n, binding, groups }: { i18n: AppI18n; binding: FocusBinding; groups: Groups }) {
  const screen = binding.nav.top;
  const field = useZone(binding, screen, 'field');
  const actions = useZone(binding, screen, 'actions');
  return <RenameView i18n={i18n} groups={groups} field={field.item(0)} action={(i) => actions.item(i)} />;
}

/** The delete question as drawn, hook-free: "Delete" first, then "Cancel" (focused first). */
export function DeleteView({ i18n, name, item }: { i18n: AppI18n; name: string; item: (index: number) => ItemBinding }) {
  const { t } = i18n;
  return (
    <Dialog title={t('groups.deleteTitle')} message={t('groups.deleteBody', { name })} testId="group-delete">
      <Button label={t('groups.delete')} variant="danger" {...item(DELETE_YES)} testId="group-delete-yes" />
      <Button label={t('action.cancel')} {...item(DELETE_NO)} testId="group-delete-no" />
    </Dialog>
  );
}

function DeleteDialog({ i18n, binding, name }: { i18n: AppI18n; binding: FocusBinding; name: string }) {
  const zone = useZone(binding, binding.nav.top, 'actions');
  return <DeleteView i18n={i18n} name={name} item={(i) => zone.item(i)} />;
}

/**
 * A page of rows (the groups', a list's channels'), as both draw it: the title (`own`: data), the
 * line under it (how a move goes while one does), then a spinner, a word (`said`: why there are
 * no rows) or the rows (`draw`), and the dialog over it.
 */
function Frame({
  i18n,
  binding,
  screen,
  testId,
  title,
  own,
  intro,
  status,
  count,
  on,
  said,
  draw,
  dialog,
}: {
  i18n: AppI18n;
  binding: FocusBinding;
  screen: Screen;
  testId: string;
  title: string;
  own: boolean;
  intro: string;
  status: GroupsStatus;
  count: number;
  on: number;
  said: string;
  draw: (index: number, item: ItemBinding) => VNode | null;
  dialog: VNode | null;
}) {
  return (
    <div class="settings__page" data-testid={testId} data-status={status} data-count={count} data-moving={on}>
      <header class="settings__header">
        <h1 class="settings__title" dir={own ? 'auto' : undefined} translate={own ? false : undefined}>
          {title}
        </h1>
      </header>
      <p class="guides__intro" data-testid="groups-intro">
        {on !== -1 ? i18n.t('groups.moving') : intro}
      </p>
      {count === 0 && (
        <div class="settings__message" data-testid={`${testId}-${status}`}>
          {status === 'loading' ? <Spinner size="l" /> : <p class="settings__text">{said}</p>}
        </div>
      )}
      {count > 0 && <VirtualList binding={binding} screen={screen} zone={screen.id === GROUPS_SCREEN ? 'rows' : 'channels'} itemSize={GROUPS.rowHeight} gap={GROUPS.rowGap} class="groups__list" testId={`${testId}-list`} renderItem={draw} />}
      {dialog}
    </div>
  );
}

/** "Channel groups": the lists and the groups, with a row's menu, the rename form or the delete question over them. */
export function GroupsPage({ i18n, binding, focus, groups }: { i18n: AppI18n; binding: FocusBinding; focus: Focus; groups: Groups }) {
  const { t } = i18n;
  const screen = groups.screen.value;
  if (screen === null) return null;
  const status = groups.status.value;
  const rows = groups.rows.value;
  const moving = groups.moving.value;
  const menu = groups.menu.value;
  const target = groups.target.value;
  const on = moving !== null && moving.zone === 'rows' ? moving.at : -1;
  let dialog: VNode | null = null;
  if (focus.screen === GROUP_MENU && menu !== null) dialog = <MenuDialog i18n={i18n} binding={binding} menu={menu} />;
  else if (focus.screen === GROUP_RENAME && target !== null) dialog = <RenameDialog i18n={i18n} binding={binding} groups={groups} />;
  else if (focus.screen === GROUP_DELETE && target !== null) dialog = <DeleteDialog i18n={i18n} binding={binding} name={listName(i18n, target).text} />;
  return (
    <Frame
      i18n={i18n}
      binding={binding}
      screen={screen}
      testId="groups"
      title={t('groups.title')}
      own={false}
      intro={t('groups.intro')}
      status={status}
      count={rows.length}
      on={on}
      said={status === 'failed' ? t('groups.failedRead') : t('groups.empty')}
      draw={(i, item) => {
        const row = rows[i];
        return row === undefined ? null : <GroupItem i18n={i18n} row={row} index={i} moving={i === on} item={item} />;
      }}
      dialog={dialog}
    />
  );
}

/** A list's channels, with a channel's menu over them. */
export function ChannelsPage({ i18n, binding, focus, groups }: { i18n: AppI18n; binding: FocusBinding; focus: Focus; groups: Groups }) {
  const shown = groups.list.value;
  const screen = groups.channelsScreen.value;
  if (shown === null || screen === null) return null;
  const rows = groups.channels.value;
  const moving = groups.moving.value;
  const menu = groups.menu.value;
  const on = moving !== null && moving.zone === 'channels' ? moving.at : -1;
  const name = listName(i18n, shown);
  return (
    <Frame
      i18n={i18n}
      binding={binding}
      screen={screen}
      testId="group-channels"
      title={name.text}
      own={name.own}
      intro={i18n.t('groups.channelsIntro')}
      status={rows === null ? 'loading' : 'ready'}
      count={rows === null ? 0 : rows.length}
      on={on}
      said={i18n.t('groups.noChannels')}
      draw={(i, item) => {
        const row = rows === null ? undefined : rows[i];
        return row === undefined ? null : <ChannelItem i18n={i18n} row={row} index={i} moving={i === on} item={item} />;
      }}
      dialog={focus.screen === CHANNEL_MENU && menu !== null ? <MenuDialog i18n={i18n} binding={binding} menu={menu} /> : null}
    />
  );
}
