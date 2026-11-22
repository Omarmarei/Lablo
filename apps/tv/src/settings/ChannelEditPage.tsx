import type { VNode } from 'preact';
import { CHANNEL_NAME_MAX, CHANNEL_NUMBER_MAX } from '@lablo/data/client';
import type { Focus, FocusBinding, ItemBinding, Screen } from '@lablo/ui';
import { Button, Dialog, Spinner, TextField, VirtualList, useZone } from '@lablo/ui';
import type { AppI18n } from '../i18n';
import type { ChannelEditor, EditAction, EditTarget } from './channel-edit';
import { CHANNEL_NAME_FIELD, CHANNEL_NUMBER_FIELD, EDIT_NUMBER, EDIT_RENAME, EDIT_SCREEN, FORM_CANCEL, FORM_SAVE, NUMBER_DIGITS } from './channel-edit';
import type { EditedChannels } from './edited-channels';
import { GROUPS } from './groups-state';
import type { Settings } from './settings-state';

/**
 * "Edit channel" and Settings › "Channels" (RELAY step 36c). Over the player the menu is a panel
 * at the inline end, drawn as the favourites panel is (the picture stays in view); from
 * "Channels" it is a dialog over the page, as "Channel groups"' menus are. The forms are dialogs in
 * both. A channel's name is data (`dir=auto`, `translate=false`); the number reads left to right.
 */

type Translate = AppI18n['t'];

function rowClass(base: string, item: ItemBinding): string {
  return item.state === 'focused' ? `${base} is-focused` : item.state === 'memory' ? `${base} is-memory` : base;
}

/** The menu's actions in words. */
export function editLabels(t: Translate): Record<EditAction, string> {
  return {
    rename: t('groups.rename'),
    number: t('channels.number'),
    hide: t('channels.hide'),
    show: t('channels.show'),
    lock: t('channels.lock'),
    unlock: t('channels.unlock'),
    reset: t('channels.reset'),
    cancel: t('action.cancel'),
  };
}

/** The line under a changed channel's name: Hidden, Renamed, Renumbered, Locked (step 38c1), and "Not in your sources now". */
export function editedLine(t: Translate, row: EditTarget): string {
  const parts: string[] = [];
  const edit = row.edit;
  if (edit !== null && edit.hidden === true) parts.push(t('groups.hidden'));
  if (edit !== null && edit.name !== undefined) parts.push(t('channels.renamed'));
  if (edit !== null && edit.number !== undefined) parts.push(t('channels.numbered'));
  if (edit !== null && edit.locked === true) parts.push(t('parental.locked'));
  if (row.item === null) parts.push(t('groups.missing'));
  return parts.join(' · ');
}

function Refused({ i18n, editor }: { i18n: AppI18n; editor: ChannelEditor }) {
  if (editor.problem.value !== 'refused') return null;
  return (
    <p class="tracks__refused" role="status" data-testid="channel-edit-problem">
      {i18n.t('channels.refused')}
    </p>
  );
}

/** The menu over the player as drawn, hook-free: "Edit channel", the channel's name, its actions as the favourites panel's rows. */
export function EditPanelView({ i18n, editor, item }: { i18n: AppI18n; editor: ChannelEditor; item: (index: number) => ItemBinding }) {
  const { t } = i18n;
  const shown = editor.target.value;
  const labels = editLabels(t);
  return (
    <aside class="tracks" data-testid="channel-edit" data-over="true" data-pending={editor.pending.value} data-problem={editor.problem.value ?? ''} data-key={shown === null ? '' : shown.key}>
      <h2 class="tracks__title">{t('player.editChannel')}</h2>
      <p class="tracks__note channel-edit__name" dir="auto" translate={false} data-testid="channel-edit-name">
        {shown === null ? '' : shown.name}
      </p>
      <div class="tracks__list" role="menu">
        {editor.actions.value.map((action, i) => {
          const at = item(i);
          return (
            <div
              key={action}
              class={rowClass('tracks__row', at)}
              role="menuitem"
              data-testid={`channel-edit-${action}`}
              data-state={at.state}
              onMouseMove={at.onHover}
              onClick={at.onPress}
            >
              <span class="tracks__name favourites__name">{labels[action]}</span>
            </div>
          );
        })}
      </div>
      <Refused i18n={i18n} editor={editor} />
    </aside>
  );
}

/** The menu from "Channels" as drawn, hook-free: the channel's name as the title, its actions in a column. */
export function EditMenuView({ i18n, editor, item }: { i18n: AppI18n; editor: ChannelEditor; item: (index: number) => ItemBinding }) {
  const shown = editor.target.value;
  const labels = editLabels(i18n.t);
  return (
    <Dialog title={shown === null ? '' : shown.name} data testId="channel-edit">
      <div class="guides__menu" data-pending={editor.pending.value} data-problem={editor.problem.value ?? ''}>
        {editor.actions.value.map((action, i) => (
          <Button key={action} label={labels[action]} variant={action === 'reset' ? 'danger' : 'secondary'} {...item(i)} testId={`channel-edit-${action}`} />
        ))}
      </div>
      <Refused i18n={i18n} editor={editor} />
    </Dialog>
  );
}

/** A form as drawn, hook-free: the name or the number, then "Save" and "Cancel". */
export function EditFormView({ i18n, editor, number, field, action }: { i18n: AppI18n; editor: ChannelEditor; number: boolean; field: ItemBinding; action: (index: number) => ItemBinding }) {
  const { t } = i18n;
  const id = number ? CHANNEL_NUMBER_FIELD : CHANNEL_NAME_FIELD;
  const testId = number ? 'channel-number' : 'channel-rename';
  const wrong = number && editor.problem.value === 'number';
  return (
    <Dialog title={t(number ? 'channels.number' : 'channels.renameTitle')} message={number ? t('channels.numberBody') : undefined} testId={testId}>
      <div class="guides__form">
        <TextField
          id={id}
          label={t(number ? 'channels.numberField' : 'field.name')}
          kind={number ? 'tel' : 'text'}
          value={editor.text.value}
          hint={t(number ? 'channels.numberHint' : 'channels.nameHint')}
          error={wrong ? t('channels.numberError', { min: 1, max: CHANNEL_NUMBER_MAX }) : null}
          maxLength={number ? NUMBER_DIGITS : CHANNEL_NAME_MAX}
          onValue={(value) => editor.setText(value)}
          edit={editor.editor.field(id)}
          {...field}
          testId={`${testId}-field`}
        />
        <div class="guides__actions">
          <Button label={t('sources.save')} variant="primary" {...action(FORM_SAVE)} testId={`${testId}-save`} />
          <Button label={t('action.cancel')} {...action(FORM_CANCEL)} testId={`${testId}-cancel`} />
        </div>
        <Refused i18n={i18n} editor={editor} />
      </div>
    </Dialog>
  );
}

function Form({ i18n, editor, binding, number }: { i18n: AppI18n; editor: ChannelEditor; binding: FocusBinding; number: boolean }) {
  const screen = binding.nav.top;
  const field = useZone(binding, screen, 'field');
  const actions = useZone(binding, screen, 'actions');
  return <EditFormView i18n={i18n} editor={editor} number={number} field={field.item(0)} action={(i) => actions.item(i)} />;
}

function Panel({ i18n, editor, screen, binding }: { i18n: AppI18n; editor: ChannelEditor; screen: Screen; binding: FocusBinding }) {
  const zone = useZone(binding, screen, 'actions');
  return <EditPanelView i18n={i18n} editor={editor} item={(i) => zone.item(i)} />;
}

function MenuDialog({ i18n, editor, screen, binding }: { i18n: AppI18n; editor: ChannelEditor; screen: Screen; binding: FocusBinding }) {
  const zone = useZone(binding, screen, 'actions');
  return <EditMenuView i18n={i18n} editor={editor} item={(i) => zone.item(i)} />;
}

/** The form on show (`null`: none). */
function formOf(i18n: AppI18n, editor: ChannelEditor, binding: FocusBinding, focus: Focus): VNode | null {
  if (focus.screen !== EDIT_RENAME && focus.screen !== EDIT_NUMBER) return null;
  return <Form i18n={i18n} editor={editor} binding={binding} number={focus.screen === EDIT_NUMBER} />;
}

/** What the pencil paints over the player (main paints it inside the player's screen): the panel, and a form over it. */
export function ChannelEditOver({ settings, i18n, binding, focus }: { settings: Settings; i18n: AppI18n; binding: FocusBinding; focus: Focus }) {
  const editor = settings.channel;
  const screen = editor.screen.value;
  if (screen === null) return null;
  return (
    <div class="channel-edit" data-testid="channel-edit-over" data-editing={editor.editor.editing.value ?? ''}>
      <Panel i18n={i18n} editor={editor} screen={screen} binding={binding} />
      {formOf(i18n, editor, binding, focus)}
    </div>
  );
}

/** "Clean channel names": its value beside its name, OK switches it. */
function CleanRow({ i18n, channels, item }: { i18n: AppI18n; channels: EditedChannels; item: ItemBinding }) {
  const { t } = i18n;
  const value = channels.clean.value;
  const failed = channels.failed.value;
  return (
    <div
      class={rowClass('groups__row', item)}
      role="menuitemcheckbox"
      aria-checked={value === null ? undefined : value ? 'true' : 'false'}
      data-testid="channels-clean"
      data-state={item.state}
      data-value={value === null ? '' : String(value)}
      data-failed={String(failed)}
      onMouseMove={item.onHover}
      onClick={item.onPress}
    >
      <div class="groups__top">
        <span class="groups__name">{t('channels.clean')}</span>
        {value !== null && (
          <span class="settings__value" data-testid="channels-clean-value">
            {t(value ? 'channels.on' : 'channels.off')}
          </span>
        )}
      </div>
      <span class={failed ? 'groups__line settings__warn' : 'groups__line'} data-testid="channels-clean-hint">
        {t(failed ? 'settings.telemetryFailed' : 'channels.cleanHint')}
      </span>
    </div>
  );
}

/** A changed channel: its number (the one it shows), its name, then what was changed. */
export function EditedItem({ i18n, row, index, item }: { i18n: AppI18n; row: EditTarget; index: number; item: ItemBinding }) {
  const hidden = row.edit !== null && row.edit.hidden === true;
  const number = row.item === null ? null : row.item.chno;
  return (
    <div
      class={rowClass(`groups__row${hidden ? ' is-hidden' : ''}`, item)}
      role="option"
      aria-selected={item.state === 'focused' ? 'true' : 'false'}
      data-testid={`channels-row-${index}`}
      data-key={row.key}
      data-found={String(row.item !== null)}
      data-hidden={String(hidden)}
      data-state={item.state}
      onMouseMove={item.onHover}
      onClick={item.onPress}
    >
      <div class="groups__top">
        <span class="groups__number" data-testid={`channels-row-${index}-number`}>
          {number === null ? '' : i18n.number(number)}
        </span>
        <span class="groups__name" dir="auto" translate={false} data-testid={`channels-row-${index}-name`}>
          {row.name}
        </span>
      </div>
      <span class="groups__line" data-testid={`channels-row-${index}-line`}>
        {editedLine(i18n.t, row)}
      </span>
    </div>
  );
}

/** Settings › "Channels": the switch, the changed channels, and "Edit channel" over them. */
export function EditedPage({ i18n, binding, focus, settings }: { i18n: AppI18n; binding: FocusBinding; focus: Focus; settings: Settings }) {
  const { t } = i18n;
  const channels = settings.channels;
  const editor = settings.channel;
  const screen = channels.screen.value;
  if (screen === null) return null;
  const status = channels.status.value;
  const rows = channels.rows.value;
  const menu = editor.screen.value;
  const count = status === 'ready' ? 1 + rows.length : 0;
  return (
    <div class="settings__page" data-testid="channels" data-status={status} data-count={rows.length}>
      <header class="settings__header">
        <h1 class="settings__title">{t('channels.title')}</h1>
      </header>
      <p class="guides__intro" data-testid="channels-intro">
        {status === 'ready' && rows.length === 0 ? t('channels.none') : t('channels.intro')}
      </p>
      {count === 0 && (
        <div class="settings__message" data-testid={`channels-${status}`}>
          {status === 'loading' ? <Spinner size="l" /> : <p class="settings__text">{t('channels.failedRead')}</p>}
        </div>
      )}
      {count > 0 && (
        <VirtualList
          binding={binding}
          screen={screen}
          zone="rows"
          itemSize={GROUPS.rowHeight}
          gap={GROUPS.rowGap}
          class="groups__list"
          testId="channels-list"
          renderItem={(i, item) => {
            if (i === 0) return <CleanRow i18n={i18n} channels={channels} item={item} />;
            const row = rows[i - 1];
            return row === undefined ? null : <EditedItem i18n={i18n} row={row} index={i - 1} item={item} />;
          }}
        />
      )}
      {focus.screen === EDIT_SCREEN && menu !== null && <MenuDialog i18n={i18n} editor={editor} screen={menu} binding={binding} />}
      {formOf(i18n, editor, binding, focus)}
    </div>
  );
}
