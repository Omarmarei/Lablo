import type { EpgFailure } from '@zoma/data';
import type { Focus, FocusBinding, ItemBinding } from '@zoma/ui';
import { Button, Dialog, Spinner, TextField, VirtualList, shapeDigits, useZone } from '@zoma/ui';
import type { AppI18n } from '../i18n';
import type { AddProblem, GuideRow, GuideState, Guides, GuidesMenu, OffsetChooser } from './guides-state';
import { ADD_CANCEL, ADD_CONFIRM, GUIDES, LINK_FIELD_ID, OFFSETS, guideState } from './guides-state';
import type { Settings } from './settings-state';
import { SETTINGS_ITEMS } from './settings-state';
import './settings.css';

/**
 * The settings screen and the guides screen (RELAY step 22b2), painted instead of the live
 * screen while one of them is on top of the live navigator. Every text comes from the catalogs;
 * links and the sources' names are data (`dir`, `translate=false`, or isolated arguments).
 */

/** Technical names shown inside sentences: never translated (arguments, so they are isolated). */
const NAMES = { guide: 'XMLTV', http: 'http://', https: 'https://' } as const;

const MINUTE_MS = 60_000;
/** U+2212, in the Latin font's subset: a minus sign as wide as the plus. */
const MINUS = '−';

type Translate = AppI18n['t'];

function rowClass(base: string, item: ItemBinding): string {
  return item.state === 'focused' ? `${base} is-focused` : item.state === 'memory' ? `${base} is-memory` : base;
}

/**
 * A guide's time offset (step 24b): `+1:30`, `−0:30`, `+12:00` in the locale's digits, drawn
 * left to right (`dir="ltr"`) in both languages; "No offset" for 0.
 */
export function offsetText(i18n: AppI18n, minutes: number): string {
  if (minutes === 0) return i18n.t('guides.offsetNone');
  const size = Math.abs(minutes);
  const rest = size % 60;
  return shapeDigits(`${minutes < 0 ? MINUS : '+'}${(size - rest) / 60}:${rest < 10 ? '0' : ''}${rest}`, i18n.locale.digits);
}

/** An offset as a line's content: "No offset" as text, any other in its own left-to-right span. */
function OffsetValue({ i18n, minutes }: { i18n: AppI18n; minutes: number }) {
  return minutes === 0 ? <span>{offsetText(i18n, 0)}</span> : <span dir="ltr">{offsetText(i18n, minutes)}</span>;
}

const CHECK = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
  </svg>
);

/** Why a guide's last try failed, in words. */
export function failureText(t: Translate, failure: EpgFailure): string {
  if (failure.code === 'http') return t('guides.failure.http', { status: failure.status ?? 0 });
  if (failure.code === 'auth') return t('guides.failure.auth');
  if (failure.code === 'network') return t('guides.failure.network');
  if (failure.code === 'format') return t('guides.failure.format', { format: NAMES.guide });
  if (failure.code === 'empty') return t('guides.failure.empty');
  return t('guides.failure.other');
}

/** What a read guide holds: its programmes' end and its match rate. */
export function readText(i18n: AppI18n, row: GuideRow): { until: string; matched: string } {
  const { t } = i18n;
  const until = row.meta?.until;
  const end = typeof until === 'number' ? new Date(until * MINUTE_MS) : null;
  const summary = row.meta?.summary;
  return {
    until: end === null ? t('guides.noProgrammes') : t('guides.until', { day: i18n.date(end, 'day'), time: i18n.time(end) }),
    matched:
      summary === undefined || summary === null
        ? ''
        : t('guides.matched', { matched: summary.matched, wanted: summary.wanted, percent: i18n.percent(summary.wanted > 0 ? summary.matched / summary.wanted : 0) }),
  };
}

function problemText(t: Translate, problem: AddProblem | null): string | null {
  if (problem === 'required') return t('field.required');
  if (problem === 'url') return t('field.url', { http: NAMES.http, https: NAMES.https });
  if (problem === 'spaces') return t('field.spaces');
  if (problem === 'listed') return t('guides.listed');
  return null;
}

function GuideItem({ i18n, row, index, state, item }: { i18n: AppI18n; row: GuideRow; index: number; state: GuideState; item: ItemBinding }) {
  const { t } = i18n;
  const failure = row.meta?.failure ?? null;
  const read = state === 'read' ? readText(i18n, row) : null;
  const summary = row.meta?.summary ?? null;
  return (
    <div
      class={rowClass(`guides__row guides__row--${row.kind}`, item)}
      role="option"
      aria-selected={item.state === 'focused' ? 'true' : 'false'}
      data-testid={`guide-${index}`}
      data-kind={row.kind}
      data-src={row.epgSrc}
      data-state={item.state}
      data-status={state}
      data-until={row.meta?.until ?? ''}
      data-matched={summary === null ? '' : summary.matched}
      data-wanted={summary === null ? '' : summary.wanted}
      data-code={failure === null ? '' : failure.code}
      data-offset={row.offset}
      onMouseMove={item.onHover}
      onClick={item.onPress}
    >
      <div class="guides__top">
        <span class="guides__link" dir="ltr" translate={false} data-testid={`guide-${index}-link`}>
          {row.link}
        </span>
        {row.offset !== 0 && (
          <span class="guides__offset" data-testid={`guide-${index}-offset`}>
            {t('guides.offsetLabel')} <OffsetValue i18n={i18n} minutes={row.offset} />
          </span>
        )}
        <span class="guides__owner">{row.kind === 'mine' ? t('guides.mine') : t('guides.from', { name: row.source })}</span>
      </div>
      <p class="guides__status" data-testid={`guide-${index}-status`}>
        {read !== null ? (
          <span>
            {read.until}
            {read.matched !== '' && ' · '}
            {read.matched}
          </span>
        ) : state === 'reading' ? (
          t('guides.reading')
        ) : state === 'unread' ? (
          t('guides.notRead')
        ) : null}
      </p>
      {failure !== null && (
        <p class="guides__failure" data-testid={`guide-${index}-failure`}>
          {failureText(t, failure)}
        </p>
      )}
    </div>
  );
}

interface PageProps {
  readonly i18n: AppI18n;
  readonly binding: FocusBinding;
  readonly focus: Focus;
}

function SettingsPage({ i18n, binding }: PageProps) {
  const { t } = i18n;
  const items = useZone(binding, binding.nav.top, 'items');
  return (
    <div class="settings__page" data-testid="settings">
      <header class="settings__header">
        <h1 class="settings__title">{t('settings.title')}</h1>
      </header>
      <div class="settings__items" role="menu">
        {SETTINGS_ITEMS.map((id, i) => {
          const item = items.item(i);
          return (
            <div key={id} class={rowClass('settings__row', item)} role="menuitem" data-testid={`settings-${id}`} data-state={item.state} onMouseMove={item.onHover} onClick={item.onPress}>
              <span class="settings__name">{t('settings.guides')}</span>
              <span class="settings__hint">{t('settings.guidesHint')}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MenuDialog({ i18n, binding, menu }: { i18n: AppI18n; binding: FocusBinding; menu: GuidesMenu }) {
  const { t } = i18n;
  const zone = useZone(binding, binding.nav.top, 'actions');
  const labels = { up: t('guides.moveUp'), down: t('guides.moveDown'), offset: t('guides.offset'), remove: t('guides.remove'), cancel: t('action.cancel') };
  return (
    <Dialog title={t('guides.menuTitle')} message={t('guides.menuLink', { link: menu.row.link })} testId="guide-menu">
      <div class="guides__menu">
        {menu.actions.map((action, i) => (
          <Button key={action} label={labels[action]} variant={action === 'remove' ? 'danger' : 'secondary'} {...zone.item(i)} testId={`guide-menu-${action}`} />
        ))}
      </div>
    </Dialog>
  );
}

/** The time offset's chooser (step 24b): the steps, the guide's own one marked and focused at first. */
function OffsetDialog({ i18n, binding, chooser }: { i18n: AppI18n; binding: FocusBinding; chooser: OffsetChooser }) {
  const { t } = i18n;
  const current = chooser.row.offset;
  return (
    <Dialog title={t('guides.offset')} message={t('guides.offsetBody', { link: chooser.row.link })} testId="guide-offset">
      <VirtualList
        binding={binding}
        screen={binding.nav.top}
        zone="steps"
        itemSize={OFFSETS.rowHeight}
        gap={OFFSETS.rowGap}
        class="guides__steps"
        testId="guide-offset-steps"
        renderItem={(i, item) => {
          const minutes = chooser.steps[i]!;
          const selected = minutes === current;
          return (
            <div
              class={`${rowClass('guides__step', item)}${selected ? ' is-selected' : ''}`}
              role="option"
              aria-selected={selected ? 'true' : 'false'}
              data-testid={`guide-offset-${i}`}
              data-minutes={minutes}
              data-state={item.state}
              data-selected={String(selected)}
              onMouseMove={item.onHover}
              onClick={item.onPress}
            >
              <span class="guides__check">{selected && CHECK}</span>
              <span class="guides__value">
                <OffsetValue i18n={i18n} minutes={minutes} />
              </span>
            </div>
          );
        }}
      />
    </Dialog>
  );
}

function AddDialog({ i18n, binding, guides }: { i18n: AppI18n; binding: FocusBinding; guides: Guides }) {
  const { t } = i18n;
  const screen = binding.nav.top;
  const field = useZone(binding, screen, 'field');
  const actions = useZone(binding, screen, 'actions');
  return (
    <Dialog title={t('guides.addTitle')} message={t('guides.addBody', { format: NAMES.guide })} testId="guide-add">
      <div class="guides__form">
        <TextField
          id={LINK_FIELD_ID}
          label={t('guides.link')}
          value={guides.text.value}
          kind="url"
          hint={t('field.linkHint', { http: NAMES.http, https: NAMES.https })}
          error={problemText(t, guides.problem.value)}
          onValue={(value) => guides.setText(value)}
          edit={guides.editor.field(LINK_FIELD_ID)}
          {...field.item(0)}
          testId="guide-add-link"
        />
        <div class="guides__actions">
          <Button label={t('guides.addConfirm')} variant="primary" {...actions.item(ADD_CONFIRM)} testId="guide-add-confirm" />
          <Button label={t('action.cancel')} {...actions.item(ADD_CANCEL)} testId="guide-add-cancel" />
        </div>
      </div>
    </Dialog>
  );
}

function GuidesPage({ i18n, binding, focus, guides }: PageProps & { guides: Guides }) {
  const { t } = i18n;
  const screen = guides.screen.value;
  if (screen === null) return null;
  const add = useZone(binding, screen, 'add');
  const status = guides.status.value;
  const rows = guides.rows.value;
  const reading = guides.reading.value;
  const menu = guides.menu.value;
  const chooser = guides.chooser.value;
  return (
    <div class="settings__page" data-testid="guides" data-status={status} data-count={rows.length} data-reading={reading}>
      <header class="settings__header">
        <h1 class="settings__title">{t('guides.title')}</h1>
        <div class="settings__end">
          <Button label={t('guides.add')} variant="primary" {...add.item(0)} testId="guides-add" />
        </div>
      </header>
      <p class="guides__intro">{t('guides.intro')}</p>
      {status === 'loading' && rows.length === 0 && (
        <div class="settings__message">
          <Spinner size="l" testId="guides-spinner" />
        </div>
      )}
      {status === 'failed' && rows.length === 0 && (
        <div class="settings__message" data-testid="guides-failed">
          <p class="settings__text">{t('guides.failedRead')}</p>
        </div>
      )}
      {status === 'ready' && rows.length === 0 && (
        <div class="settings__message" data-testid="guides-empty">
          <p class="settings__text">{t('guides.empty', { format: NAMES.guide })}</p>
        </div>
      )}
      {rows.length > 0 && (
        <VirtualList
          binding={binding}
          screen={screen}
          zone="guides"
          itemSize={GUIDES.rowHeight}
          gap={GUIDES.rowGap}
          class="guides__list"
          testId="guides-list"
          renderItem={(i, item) => {
            const row = rows[i];
            return row === undefined ? null : <GuideItem i18n={i18n} row={row} index={i} state={guideState(row, reading)} item={item} />;
          }}
        />
      )}
      {focus.screen === 'guide-menu' && menu !== null && <MenuDialog i18n={i18n} binding={binding} menu={menu} />}
      {focus.screen === 'guide-offset' && chooser !== null && <OffsetDialog i18n={i18n} binding={binding} chooser={chooser} />}
      {focus.screen === 'guide-add' && <AddDialog i18n={i18n} binding={binding} guides={guides} />}
    </div>
  );
}

interface Props {
  readonly settings: Settings;
  readonly i18n: AppI18n;
  readonly binding: FocusBinding;
  readonly focus: Focus;
}

/** The settings screens: the one on top, and the guides screen under its menu or add form. */
export function SettingsScreen({ settings, i18n, binding, focus }: Props) {
  const guides = settings.guides;
  const onGuides = focus.screen === 'guides' || focus.screen === 'guide-menu' || focus.screen === 'guide-offset' || focus.screen === 'guide-add';
  return (
    <main
      class="settings"
      data-testid="settings-screen"
      data-ready="true"
      data-language={i18n.locale.pseudo ? 'pseudo' : i18n.locale.language}
      data-pending={guides.pending.value}
      data-editing={guides.editor.editing.value ?? ''}
      data-screen={focus.screen}
      data-zone={focus.zone}
      data-index={focus.index}
      data-pointer={String(focus.pointer)}
      data-dir={focus.dir}
    >
      {focus.screen === 'settings' && <SettingsPage i18n={i18n} binding={binding} focus={focus} />}
      {onGuides && <GuidesPage i18n={i18n} binding={binding} focus={focus} guides={guides} />}
    </main>
  );
}
