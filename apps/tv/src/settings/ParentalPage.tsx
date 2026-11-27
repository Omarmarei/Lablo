import type { VNode } from 'preact';
import type { Focus, FocusBinding, ItemBinding, Screen } from '@lablo/ui';
import { Button, Dialog, Spinner, VirtualList, useZone } from '@lablo/ui';
import type { AppI18n } from '../i18n';
import { GROUPS } from './groups-state';
import type { LockRow, PageStatus, ParentalPage, ParentalRow } from './parental-page';
import { LOCKED_SCREEN, PARENTAL_SCREEN } from './parental-page';
import type { PinCheck } from './pin-check';
import { CHECK_SCREEN, NONE_BUTTONS, NONE_SCREEN, PICK_HEADER, PICK_SCREEN } from './pin-check';
import type { CheckSource } from './source-login';
import { settingsWindow } from './settings-window';
import { shownHost } from './sources-state';

/**
 * Settings › "Parental control" and "Locked groups" (RELAY step 38c1): the page's rows as the
 * settings' rows (a name, its value beside it, a line under it), and the groups as "Channel
 * groups"' rows with their lock beside the name. Groups' names are data (`dir=auto`,
 * `translate=false`); a group without a name is the catalog's "Other channels".
 *
 * The PIN's login check (step 38c2): the pick of a source ("Whose login?", each source's name and
 * server), and the dialog when no source keeps a login, over the page (or over nothing, from the
 * rails' no-PIN dialog). Its form is the settings' login form, drawn by the settings screen.
 */

type Translate = AppI18n['t'];

function rowClass(base: string, item: ItemBinding): string {
  return item.state === 'focused' ? `${base} is-focused` : item.state === 'memory' ? `${base} is-memory` : base;
}

/** A row's name, its value (`''`: none) and the line under it. */
export function parentalText(t: Translate, row: ParentalRow, page: { adult: boolean | null; failed: boolean; changedPin: boolean }): { name: string; value: string; hint: string; warn: boolean } {
  if (row === 'change') return { name: t('parental.change'), value: '', hint: t(page.changedPin ? 'parental.changed' : 'parental.changeHint'), warn: false };
  if (row === 'adult') {
    const value = page.adult === null ? '' : t(page.adult ? 'parental.on' : 'parental.off');
    return { name: t('parental.adultGroups'), value, hint: t(page.failed ? 'parental.refused' : 'parental.adultHint'), warn: page.failed };
  }
  if (row === 'groups') return { name: t('parental.lockedGroups'), value: '', hint: t('parental.groupsHint'), warn: false };
  if (row === 'forgot') return { name: t('parental.forgot'), value: '', hint: t('parental.forgotHint'), warn: false };
  return { name: t('parental.set'), value: '', hint: t('parental.setHint'), warn: false };
}

/** A group's kind in words. */
function kindText(t: Translate, kind: LockRow['group']['kind']): string {
  return t(kind === 'live' ? 'live.title' : kind === 'movie' ? 'movies.title' : 'series.title');
}

/** The line under a group: its kind, "Adult" when it is, its source with two or more. */
export function lockLine(t: Translate, row: LockRow): string {
  const parts = [kindText(t, row.group.kind)];
  if (row.adult) parts.push(t('parental.adult'));
  if (row.source !== '') parts.push(t('guides.from', { name: row.source }));
  return parts.join(' · ');
}

/** A source on the PIN's pick: its name, and its server's host under it (two sources can share a name). */
export function pickLine(source: CheckSource): string {
  return shownHost(source.type === 'xtream' ? source.account.base : source.url);
}

/** The page as drawn, hook-free: its rows, or why there are none. */
export function ParentalView({ i18n, page, item }: { i18n: AppI18n; page: ParentalPage; item: (index: number) => ItemBinding }) {
  const { t } = i18n;
  const rows = page.rows.value;
  const status = page.status.value;
  const state = { adult: page.adult.value, failed: page.failed.value, changedPin: page.changedPin.value };
  return (
    <div class="settings__page" data-testid="parental" data-status={status} data-pin={page.pin.value === null ? '' : String(page.pin.value)}>
      <header class="settings__header">
        <h1 class="settings__title">{t('settings.parental')}</h1>
      </header>
      {rows.length === 0 && message(status, t('parental.failedRead'), 'parental')}
      {rows.length > 0 && (
        <div class="settings__items" role="menu" style={{ '--settings-row': `${settingsWindow(0, rows.length).height}px` }}>
          {rows.map((row, i) => {
            const binding = item(i);
            const text = parentalText(t, row, state);
            return (
              <div
                key={row}
                class={rowClass('settings__row settings__switch', binding)}
                role="menuitem"
                data-testid={`parental-${row}`}
                data-state={binding.state}
                data-value={row === 'adult' && state.adult !== null ? String(state.adult) : ''}
                onMouseMove={binding.onHover}
                onClick={binding.onPress}
              >
                <div class="settings__top">
                  <span class="settings__name">{text.name}</span>
                  {text.value !== '' && (
                    <span class="settings__value" data-testid={`parental-${row}-value`}>
                      {text.value}
                    </span>
                  )}
                </div>
                <span class={text.warn ? 'settings__hint settings__warn' : 'settings__hint'} data-testid={`parental-${row}-hint`}>
                  {text.hint}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Why there are no rows: a spinner while they are read, else `said` (drawn in place, so VNode tests see it). */
function message(status: PageStatus, said: string, testId: string): VNode {
  return (
    <div class="settings__message" data-testid={`${testId}-${status}`}>
      {status === 'loading' ? <Spinner size="l" /> : <p class="settings__text">{said}</p>}
    </div>
  );
}

/** A group on "Locked groups": its name, its lock beside it, the line under it. */
export function LockItem({ i18n, row, index, item }: { i18n: AppI18n; row: LockRow; index: number; item: ItemBinding }) {
  const { t } = i18n;
  const own = row.group.name !== '';
  return (
    <div
      class={rowClass('groups__row', item)}
      role="option"
      aria-selected={item.state === 'focused' ? 'true' : 'false'}
      data-testid={`locked-${index}`}
      data-kind={row.group.kind}
      data-name={row.group.name}
      data-locked={String(row.locked)}
      data-adult={String(row.adult)}
      data-state={item.state}
      onMouseMove={item.onHover}
      onClick={item.onPress}
    >
      <div class="groups__top">
        <span class="groups__name" dir={own ? 'auto' : undefined} translate={own ? false : undefined} data-testid={`locked-${index}-name`}>
          {own ? row.group.name : t('live.noGroup')}
        </span>
        <span class="settings__value" data-testid={`locked-${index}-value`}>
          {t(row.locked ? 'parental.locked' : 'parental.open')}
        </span>
      </div>
      <span class="groups__line" data-testid={`locked-${index}-line`}>
        {lockLine(t, row)}
      </span>
    </div>
  );
}

function Rows({ i18n, binding, page, screen }: { i18n: AppI18n; binding: FocusBinding; page: ParentalPage; screen: Screen }) {
  const zone = useZone(binding, screen, 'rows');
  return <ParentalView i18n={i18n} page={page} item={(i) => zone.item(i)} />;
}

/** A source on the PIN's pick. */
export function PickItem({ source, index, item }: { source: CheckSource; index: number; item: ItemBinding }) {
  return (
    <div
      class={rowClass('groups__row', item)}
      role="option"
      aria-selected={item.state === 'focused' ? 'true' : 'false'}
      data-testid={`pin-pick-${index}`}
      data-src={source.id}
      data-state={item.state}
      onMouseMove={item.onHover}
      onClick={item.onPress}
    >
      <div class="groups__top">
        <span class="groups__name" dir="auto" translate={false} data-testid={`pin-pick-${index}-name`}>
          {source.name}
        </span>
      </div>
      <span class="groups__line" dir="ltr" translate={false} data-testid={`pin-pick-${index}-line`}>
        {pickLine(source)}
      </span>
    </div>
  );
}

/** The pick's "Use your phone" (step 38c4), in its header as Sources' "Add from your phone". */
function PickPhone({ i18n, binding, screen }: { i18n: AppI18n; binding: FocusBinding; screen: Screen }) {
  const header = useZone(binding, screen, PICK_HEADER);
  return (
    <div class="settings__end">
      <Button label={i18n.t('pinCheck.usePhone')} variant="primary" {...header.item(0)} testId="pin-pick-phone" />
    </div>
  );
}

/** The PIN's pick (step 38c2): whose login to type, each source with its server; "Use your phone" when the app can pair (step 38c4). */
function Pick({ i18n, binding, check, screen }: { i18n: AppI18n; binding: FocusBinding; check: PinCheck; screen: Screen }) {
  const { t } = i18n;
  const sources = check.sources.value;
  return (
    <div class="settings__page" data-testid="pin-pick" data-count={sources.length}>
      <header class="settings__header">
        <h1 class="settings__title">{t('pinCheck.pickTitle')}</h1>
        {check.canUsePhone && <PickPhone i18n={i18n} binding={binding} screen={screen} />}
      </header>
      <p class="guides__intro">{t('pinCheck.pickIntro')}</p>
      <VirtualList
        binding={binding}
        screen={screen}
        zone="rows"
        itemSize={GROUPS.rowHeight}
        gap={GROUPS.rowGap}
        class="groups__list"
        testId="pin-pick-list"
        renderItem={(i, item) => {
          const source = sources[i];
          return source === undefined ? null : <PickItem source={source} index={i} item={item} />;
        }}
      />
    </div>
  );
}

/** No source keeps a login (step 38c2): why, and one OK. */
function NoLogin({ i18n, binding }: { i18n: AppI18n; binding: FocusBinding }) {
  const { t } = i18n;
  const zone = useZone(binding, binding.nav.top, NONE_BUTTONS);
  return (
    <Dialog title={t('pinCheck.noneTitle')} message={t('pinCheck.noneMessage')} testId="pin-none">
      <Button label={t('parental.ok')} variant="primary" {...zone.item(0)} testId="pin-none-ok" />
    </Dialog>
  );
}

/** What is under the PIN's form or its dialog: the pick, else the page when the check came from it. */
function Under({ i18n, binding, page }: { i18n: AppI18n; binding: FocusBinding; page: ParentalPage }) {
  const pick = page.check.pickScreen.value;
  if (pick !== null) return <Pick i18n={i18n} binding={binding} check={page.check} screen={pick} />;
  const screen = page.screen.value;
  return screen === null ? null : <Rows i18n={i18n} binding={binding} page={page} screen={screen} />;
}

/** "Locked groups" as drawn: the title, a line on what OK does, then the groups. */
function Groups({ i18n, binding, page }: { i18n: AppI18n; binding: FocusBinding; page: ParentalPage }) {
  const { t } = i18n;
  const screen = page.lockedScreen.value;
  if (screen === null) return null;
  const rows = page.groups.value;
  const status = page.lockedStatus.value;
  return (
    <div class="settings__page" data-testid="locked-groups" data-status={status} data-count={rows.length}>
      <header class="settings__header">
        <h1 class="settings__title">{t('parental.lockedGroups')}</h1>
      </header>
      <p class={page.failed.value ? 'guides__intro settings__warn' : 'guides__intro'} data-testid="locked-groups-intro">
        {t(page.failed.value ? 'parental.refused' : 'parental.groupsIntro')}
      </p>
      {rows.length === 0 && message(status, t(status === 'failed' ? 'parental.failedRead' : 'parental.noGroups'), 'locked-groups')}
      {rows.length > 0 && (
        <VirtualList
          binding={binding}
          screen={screen}
          zone="rows"
          itemSize={GROUPS.rowHeight}
          gap={GROUPS.rowGap}
          class="groups__list"
          testId="locked-groups-list"
          renderItem={(i, item) => {
            const row = rows[i];
            return row === undefined ? null : <LockItem i18n={i18n} row={row} index={i} item={item} />;
          }}
        />
      )}
    </div>
  );
}

/** Settings › "Parental control", "Locked groups" over it, or the PIN's check (its form is the settings screen's). */
export function ParentalPageScreen({ i18n, binding, focus, page }: { i18n: AppI18n; binding: FocusBinding; focus: Focus; page: ParentalPage }) {
  if (focus.screen === LOCKED_SCREEN) return <Groups i18n={i18n} binding={binding} page={page} />;
  const screen = page.screen.value;
  if (focus.screen === PARENTAL_SCREEN && screen !== null) return <Rows i18n={i18n} binding={binding} page={page} screen={screen} />;
  const pick = page.check.pickScreen.value;
  if (focus.screen === PICK_SCREEN && pick !== null) return <Pick i18n={i18n} binding={binding} check={page.check} screen={pick} />;
  if (focus.screen === CHECK_SCREEN) return <Under i18n={i18n} binding={binding} page={page} />;
  if (focus.screen === NONE_SCREEN) {
    return (
      <div>
        <Under i18n={i18n} binding={binding} page={page} />
        <NoLogin i18n={i18n} binding={binding} />
      </div>
    );
  }
  return null;
}
