import type { EpgFailure, EpgSummary } from '@lablo/data';
import type { Focus, FocusBinding, ItemBinding, Screen } from '@lablo/ui';
import { Button, Dialog, Spinner, TextField, VirtualList, listWindow, shapeDigits, useZone } from '@lablo/ui';
import type { AppI18n } from '../i18n';
import { errorText } from '../onboarding/load-text';
import { PAIR_SCREEN } from '../pairing/pair-state';
import { PairPage } from '../pairing/PairPage';
import { BACKUP_CONFIRM, BACKUP_SCREEN } from './backup-state';
import { BackupPageScreen } from './BackupPage';
import { EDIT_SCREENS } from './channel-edit';
import { EditedPage } from './ChannelEditPage';
import { CHANNELS_SCREEN } from './edited-channels';
import { CHANNEL_MENU, GROUP_CHANNELS, GROUP_SCREENS } from './groups-state';
import { ChannelsPage, GroupsPage } from './GroupsPage';
import { LANGUAGE_SCREEN } from './language-choice';
import { LanguageDialog, languageLine, languageNames } from './LanguageDialog';
import type { AddProblem, GuideAction, GuideRow, GuideState, Guides, GuidesMenu, OffsetChooser } from './guides-state';
import { ADD_CANCEL, ADD_CONFIRM, GUIDES, HEADER_ADD, HEADER_UNMATCHED, LINK_FIELD_ID, OFFSETS, guideState, summaryOf } from './guides-state';
import { MAPPING_SCREEN } from './mapping-state';
import { MappingReading } from '../guide/MappingReading';
import { MappingPage } from './MappingPage';
import { PARENTAL_SCREENS } from './parental-page';
import { PLAYER_SETTINGS_SCREEN } from './player-settings';
import { CONNECTION_SCREEN, TEST_SCREEN } from './connection-check';
import { ConnectionPage, TestStreamPage } from './ConnectionPage';
import { PlayerSettingsPage } from './PlayerSettingsPage';
import { ABOUT_DOC_SCREEN, ABOUT_INFO_SCREEN, ABOUT_SCREEN } from './about-page';
import { AboutDocPage, AboutInfoPage, AboutListPage } from './AboutPage';
import { HELP_SCREEN, HELP_TOPIC_SCREEN } from './help-page';
import { HelpListPage, HelpTopicPage } from './HelpPage';
import { CHECK_SCREEN } from './pin-check';
import { ParentalPageScreen } from './ParentalPage';
import type { Settings, SettingsItem } from './settings-state';
import { SETTINGS_VISIBLE } from './settings-state';
import type { LoginField, LoginForm, LoginSource } from './source-login';
import { LOGIN_CANCEL, LOGIN_FIELDS, LOGIN_PHONE, LOGIN_SAVE, LOGIN_SCREEN, loginFieldId } from './source-login';
import type { SourceRow, SourcesList } from './sources-state';
import { SOURCE_MENU, SOURCE_REMOVE, SOURCES_SCREEN, shownHost } from './sources-state';
import { ADD_SCREEN } from './source-add';
import { SourceAddPage, SourceMenuDialog, SourceRemoveDialog, SourcesHeader } from './SourceDialogs';
import type { ReportRow, ReportState } from './diag-report';
import type { TelemetrySwitch } from './telemetry-switch';
import type { UnmatchedList } from './unmatched-state';
import { UNMATCHED } from './unmatched-state';
import './settings.css';

/**
 * The settings screen, the guides screen (RELAY step 22b2), "Channels without a guide" (step 24c),
 * the manual mapping's picker (step 24e, `MappingPage.tsx`), the sources screen (step 30c3a), the
 * pairing screen from its header (step 31c2a, `PairPage.tsx`), the backup page (step 32d2b,
 * `BackupPage.tsx`), the usage reports' row (step 33b3) and "Channel groups" (step 35d, `GroupsPage.tsx`), painted instead of the live screen while one of them is on top of the live navigator.
 * Every text comes from the catalogs; links, channels and the sources' and categories' names are
 * data (`dir`, `translate=false`, or isolated arguments).
 */

/** Technical names shown inside sentences: never translated (arguments, so they are isolated). */
const NAMES = { guide: 'XMLTV', http: 'http://', https: 'https://', tags: 'HD, FHD', xtream: 'Xtream', m3u: 'M3U' } as const;

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
  if (failure.code === 'storage') return t('guides.failure.storage');
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

/** One line of a guide's matches (step 24c): what it counts, in words, and how many. */
export interface MatchLine {
  readonly id: 'id' | 'xtream-id' | 'name' | 'match-name' | 'override' | 'ties' | 'declared' | 'used';
  readonly label: string;
  readonly n: number;
  readonly value: string;
}

/**
 * A guide's matches line by line: the methods in the cascade's order after "set by you" (as RELAY
 * lists them: by id, by the panel's id, by name, by a name without its tags, then set by you),
 * the ties, then its XMLTV channels declared and in use.
 */
export function matchLines(i18n: AppI18n, summary: EpgSummary): MatchLine[] {
  const { t } = i18n;
  const by = summary.byMethod;
  const lines: [MatchLine['id'], string, number][] = [
    ['id', t('guides.byId'), by.id],
    ['xtream-id', t('guides.byXtreamId'), by['xtream-id']],
    ['name', t('guides.byName'), by.name],
    ['match-name', t('guides.byMatchName', { tags: NAMES.tags }), by['match-name']],
    ['override', t('guides.byOverride'), by.override],
    ['ties', t('guides.ties'), summary.ambiguous],
    ['declared', t('guides.declared'), summary.declared],
    ['used', t('guides.used'), summary.used],
  ];
  return lines.map(([id, label, n]) => ({ id, label, n, value: i18n.number(n) }));
}

/** The header's second button: how many live channels no guide matches, once counted. */
export function unmatchedLabel(i18n: AppI18n, count: number | null): string {
  return count === null ? i18n.t('unmatched.title') : i18n.t('guides.unmatched', { count });
}

function problemText(t: Translate, problem: AddProblem | null): string | null {
  if (problem === 'required') return t('field.required');
  if (problem === 'url') return t('field.url', { http: NAMES.http, https: NAMES.https });
  if (problem === 'spaces') return t('field.spaces');
  if (problem === 'listed') return t('guides.listed');
  return null;
}

export function GuideItem({ i18n, row, index, state, item }: { i18n: AppI18n; row: GuideRow; index: number; state: GuideState; item: ItemBinding }) {
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
      data-needs={String(row.needs)}
      onMouseMove={item.onHover}
      onClick={item.onPress}
    >
      <div class="guides__top">
        <span class="guides__link" dir="ltr" translate={false} data-testid={`guide-${index}-link`}>
          {row.link}
        </span>
        {row.offset !== 0 && (
          <span class="guides__offset" data-testid={`guide-${index}-offset`}>
            <span>{t('guides.offsetLabel')}</span> <OffsetValue i18n={i18n} minutes={row.offset} />
          </span>
        )}
        <span class="guides__owner">{row.kind === 'mine' ? t('guides.mine') : t('guides.from', { name: row.source })}</span>
      </div>
      {/* A guide on a blocked server (step 30c3a), or without its link (step 32d4c): that line alone under the link, so the row keeps two lines. */}
      {row.blocked ? (
        <p class="guides__failure" data-testid={`guide-${index}-blocked`}>
          {t('guides.blocked')}
        </p>
      ) : row.needs ? (
        <p class="guides__failure" data-testid={`guide-${index}-needs`}>
          {t('sources.needsLink')}
        </p>
      ) : (
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
      )}
      {!row.blocked && !row.needs && failure !== null && (
        <p class="guides__failure" data-testid={`guide-${index}-failure`}>
          {failureText(t, failure)}
        </p>
      )}
    </div>
  );
}

/** A source's kind (step 30c3a): "Xtream login", "M3U playlist" or "M3U file" (step 31d2b1), the format's name isolated. */
export function sourceKindText(t: Translate, row: SourceRow): string {
  if (row.type === 'm3u-file') return t('sources.file', { format: NAMES.m3u });
  return row.type === 'xtream' ? t('sources.xtream', { name: NAMES.xtream }) : t('sources.m3u', { format: NAMES.m3u });
}

/**
 * A source's line under its name: when it was last updated ("Updated {day}, {time}", or "Not
 * updated yet"); for a source on a blocked server, that it isn't any more, since when it was. A
 * file from the phone is never updated by itself: when it was sent (step 31d2b1), or, with no
 * catalog (a restored backup holds no file, step 32c2), that it has to be sent again. Step 32d4b:
 * a save's refresh running ("Updating…") or why it failed, else that it needs its login or link.
 * Step 39s1: a source whose refresh failed for space says so, with when it was last updated.
 */
export function statusText(i18n: AppI18n, row: SourceRow): string {
  const answer = row.answer;
  if (answer !== null) return answer.state === 'updating' ? i18n.t('sources.updating') : answer.state === 'removing' ? i18n.t('sources.removing') : errorText(i18n.t, answer.code, answer.status);
  if (row.needs !== null) return row.needs === 'login' ? i18n.t('sources.needsLogin') : i18n.t('sources.needsLink');
  const at = row.checkedAt === null ? null : new Date(row.checkedAt);
  if (row.type === 'm3u-file') return at === null ? i18n.t('sources.fileAgain') : i18n.t('sources.fileSent', { day: i18n.date(at, 'day'), time: i18n.time(at) });
  if (row.storage) return at === null ? i18n.t('sources.storage') : i18n.t('sources.storageSince', { day: i18n.date(at, 'day'), time: i18n.time(at) });
  if (row.blocked) return at === null ? i18n.t('sources.blocked') : i18n.t('sources.blockedSince', { day: i18n.date(at, 'day'), time: i18n.time(at) });
  return at === null ? i18n.t('sources.notUpdated') : i18n.t('sources.updated', { day: i18n.date(at, 'day'), time: i18n.time(at) });
}

/** A source's line is in the warning colour: blocked, without its login, its save failed (step 32d4b), or it failed for space (step 39s1). */
export function warns(row: SourceRow): boolean {
  return row.blocked || row.storage || row.needs !== null || (row.answer !== null && row.answer.state === 'failed');
}

export function SourceItem({ i18n, row, index, item }: { i18n: AppI18n; row: SourceRow; index: number; item: ItemBinding }) {
  const { t } = i18n;
  const answer = row.answer;
  return (
    <div
      class={rowClass('guides__row sources__row', item)}
      role="option"
      aria-selected={item.state === 'focused' ? 'true' : 'false'}
      data-testid={`source-${index}`}
      data-src={row.id}
      data-type={row.type}
      data-state={item.state}
      data-checked={row.checkedAt ?? ''}
      data-blocked={String(row.blocked)}
      data-storage={String(row.storage)}
      data-needs={row.needs ?? ''}
      data-answer={answer === null ? '' : answer.state}
      data-code={answer !== null && answer.state === 'failed' ? answer.code : ''}
      onMouseMove={item.onHover}
      onClick={item.onPress}
    >
      <div class="guides__top">
        <span class="sources__name" dir="auto" translate={false} data-testid={`source-${index}-name`}>
          {row.name}
        </span>
        <span class="guides__owner" data-testid={`source-${index}-kind`}>
          {sourceKindText(t, row)}
          {row.host !== '' && ' · '}
          {row.host !== '' && (
            <span dir="ltr" translate={false}>
              {row.host}
            </span>
          )}
        </span>
      </div>
      {/* One line under the name (a row has room for two): the warning's colour when blocked, without its login, or its save failed. */}
      <p class={warns(row) ? 'guides__failure' : 'guides__status'} data-testid={`source-${index}-status`}>
        {statusText(i18n, row)}
      </p>
    </div>
  );
}

/** A login form's field: its label, and its hint (an M3U link: the host it was on). */
export function loginLabel(t: Translate, field: LoginField): string {
  if (field === 'server') return t('field.server');
  if (field === 'username') return t('field.username');
  return field === 'password' ? t('field.password') : t('field.playlist');
}

export function loginHint(t: Translate, field: LoginField, source: LoginSource): string | undefined {
  if (field === 'server') return t('field.serverHint', { scheme: NAMES.http });
  if (field !== 'playlist') return undefined;
  // (A link given again: the host it was on; the PIN's check of one, step 38c2: the host it is on.)
  const host = source.type === 'm3u' ? shownHost(source.url === null ? source.origin : source.url) : '';
  return host === '' ? t('field.linkHint', { http: NAMES.http, https: NAMES.https }) : t('sources.linkWas', { host });
}

/** The form's title, its line and its first button: a login given again, or the PIN's check of one (step 38c2). */
export function loginWords(t: Translate, source: LoginSource, checking: boolean): { title: string; body: string; save: string } {
  const xtream = source.type === 'xtream';
  if (checking) {
    return { title: t(xtream ? 'pinCheck.loginTitle' : 'pinCheck.linkTitle', { name: source.name }), body: t('pinCheck.formBody'), save: t('pinCheck.check') };
  }
  return { title: t(xtream ? 'sources.loginTitle' : 'sources.linkTitle', { name: source.name }), body: t('sources.formBody'), save: t('sources.save') };
}

/**
 * The login form as drawn (step 32d4b), hook-free: the fields, then "Save" and "Cancel"; for the
 * PIN's check, "Check", "Use your phone" when the app can pair (step 38c4) and the mismatch's line.
 */
export function LoginFormView({ i18n, form, source, field, action }: { i18n: AppI18n; form: LoginForm; source: LoginSource; field: (index: number) => ItemBinding; action: (index: number) => ItemBinding }) {
  const { t } = i18n;
  const values = form.values.value;
  const problems = form.problems.value;
  const fields = LOGIN_FIELDS[source.type];
  const words = loginWords(t, source, form.checking.value);
  return (
    <Dialog title={words.title} message={words.body} testId="source-login">
      <div class="guides__form sources__form">
        {fields.map((id, i) => (
          <TextField
            key={id}
            id={loginFieldId(id)}
            label={loginLabel(t, id)}
            value={values[id] ?? ''}
            kind={id === 'password' ? 'password' : id === 'username' ? 'text' : 'url'}
            hint={loginHint(t, id, source)}
            error={problemText(t, problems[id] ?? null)}
            onValue={(value) => form.setValue(id, value)}
            edit={form.editor.field(loginFieldId(id))}
            {...field(i)}
            testId={`source-login-${id}`}
          />
        ))}
        {form.mismatch.value && (
          <p class="settings__hint settings__warn" data-testid="source-login-mismatch">
            {t('pinCheck.mismatch')}
          </p>
        )}
        <div class="guides__actions">
          <Button label={words.save} variant="primary" {...action(LOGIN_SAVE)} testId="source-login-save" />
          {form.phone.value && <Button label={t('pinCheck.usePhone')} {...action(LOGIN_PHONE)} testId="source-login-phone" />}
          <Button label={t('action.cancel')} {...action(form.phone.value ? LOGIN_PHONE + 1 : LOGIN_CANCEL)} testId="source-login-cancel" />
        </div>
      </div>
    </Dialog>
  );
}

function LoginDialog({ i18n, binding, form, source }: { i18n: AppI18n; binding: FocusBinding; form: LoginForm; source: LoginSource }) {
  const fields = useZone(binding, binding.nav.top, 'fields');
  const actions = useZone(binding, binding.nav.top, 'actions');
  return <LoginFormView i18n={i18n} form={form} source={source} field={(i) => fields.item(i)} action={(i) => actions.item(i)} />;
}

/** The sources screen (step 30c3a): each source, its server and when it was last updated, or that it is blocked; the login form over it (step 32d4b). */
export function SourcesPage({ i18n, binding, focus, list }: { i18n: AppI18n; binding: FocusBinding; focus: Focus; list: SourcesList }) {
  const { t } = i18n;
  const screen = list.screen.value;
  if (screen === null) return null;
  const status = list.status.value;
  const rows = list.rows.value;
  const blocked = rows.filter((row) => row.blocked).length;
  const needs = rows.filter((row) => row.needs !== null).length;
  const form = list.form;
  const editing = form === null ? null : form.source.value;
  const add = list.add;
  // "Add a source" (step 40f) takes the page's place, its states with it.
  if (add !== null && focus.screen === ADD_SCREEN) return <SourceAddPage i18n={i18n} binding={binding} screen={binding.nav.top} add={add} />;
  const menu = list.menu.value;
  const removing = list.removing.value;
  return (
    <div class="settings__page" data-testid="sources" data-status={status} data-count={rows.length} data-blocked={blocked} data-needs={needs}>
      <header class="settings__header">
        <h1 class="settings__title">{t('sources.title')}</h1>
        {list.canAdd && <SourcesHeader i18n={i18n} binding={binding} screen={screen} list={list} />}
      </header>
      <p class="guides__intro">{t('sources.intro')}</p>
      {status === 'loading' && (
        <div class="settings__message">
          <Spinner size="l" testId="sources-spinner" />
        </div>
      )}
      {status === 'failed' && (
        <div class="settings__message" data-testid="sources-failed">
          <p class="settings__text">{t('sources.failedRead')}</p>
        </div>
      )}
      {rows.length > 0 && (
        <VirtualList
          binding={binding}
          screen={screen}
          zone="sources"
          itemSize={GUIDES.rowHeight}
          gap={GUIDES.rowGap}
          class="guides__list"
          testId="sources-list"
          renderItem={(i, item) => {
            const row = rows[i];
            return row === undefined ? null : <SourceItem i18n={i18n} row={row} index={i} item={item} />;
          }}
        />
      )}
      {focus.screen === LOGIN_SCREEN && form !== null && editing !== null && <LoginDialog i18n={i18n} binding={binding} form={form} source={editing} />}
      {focus.screen === SOURCE_MENU && menu !== null && <SourceMenuDialog i18n={i18n} binding={binding} menu={menu} />}
      {focus.screen === SOURCE_REMOVE && removing !== null && <SourceRemoveDialog i18n={i18n} binding={binding} removing={removing} />}
    </div>
  );
}

interface PageProps {
  readonly i18n: AppI18n;
  readonly binding: FocusBinding;
  readonly focus: Focus;
}

/** A settings row's name and the line under it (the usage reports' line while on, `telemetryText`; "Language"'s: the languages' own names). */
export function itemText(t: Translate, id: SettingsItem): { name: string; hint: string } {
  if (id === 'language') return { name: t('settings.language'), hint: languageLine() };
  if (id === 'parental') return { name: t('settings.parental'), hint: t('settings.parentalHint') };
  if (id === 'player') return { name: t('settings.player'), hint: t('settings.playerHint') };
  if (id === 'report') return { name: t('settings.report'), hint: t('settings.reportHint') };
  if (id === 'connection') return { name: t('settings.connection'), hint: t('settings.connectionHint') };
  if (id === 'about') return { name: t('settings.about'), hint: t('settings.aboutHint') };
  if (id === 'help') return { name: t('settings.help'), hint: t('settings.helpHint') };
  if (id === 'groups') return { name: t('settings.groups'), hint: t('settings.groupsHint') };
  if (id === 'channels') return { name: t('settings.channels'), hint: t('settings.channelsHint') };
  if (id === 'telemetry') return { name: t('settings.telemetry'), hint: t('settings.telemetryOnHint') };
  if (id === 'backup') return { name: t('settings.backup'), hint: t('settings.backupHint') };
  return id === 'sources' ? { name: t('settings.sources'), hint: t('settings.sourcesHint') } : { name: t('settings.guides'), hint: t('settings.guidesHint') };
}

/**
 * The usage reports' value and the line under it (step 33b3): none and the "on" line before the
 * switch is read; "Couldn't change it" after a change that didn't take.
 */
export function telemetryText(t: Translate, value: boolean | null, failed: boolean): { value: string; hint: string } {
  const shown = value === null ? '' : value ? t('settings.telemetryOn') : t('settings.telemetryOff');
  if (failed) return { value: shown, hint: t('settings.telemetryFailed') };
  return { value: shown, hint: value === false ? t('settings.telemetryOffHint') : t('settings.telemetryOnHint') };
}

/** "Usage and crash reports" (step 33b3): a checkbox in the menu, its value beside its name. */
export function TelemetryRow({ i18n, item, telemetry }: { i18n: AppI18n; item: ItemBinding; telemetry: TelemetrySwitch }) {
  const { t } = i18n;
  const value = telemetry.value.value;
  const failed = telemetry.failed.value;
  const text = telemetryText(t, value, failed);
  return (
    <div
      class={rowClass('settings__row settings__switch', item)}
      role="menuitemcheckbox"
      aria-checked={value === null ? undefined : value ? 'true' : 'false'}
      data-testid="settings-telemetry"
      data-state={item.state}
      data-value={value === null ? '' : String(value)}
      data-busy={String(telemetry.busy.value)}
      data-failed={String(failed)}
      onMouseMove={item.onHover}
      onClick={item.onPress}
    >
      <div class="settings__top">
        <span class="settings__name">{itemText(t, 'telemetry').name}</span>
        {value !== null && (
          <span class="settings__value" data-testid="settings-telemetry-value">
            {text.value}
          </span>
        )}
      </div>
      <span class={failed ? 'settings__hint settings__warn' : 'settings__hint'} data-testid="settings-telemetry-hint">
        {text.hint}
      </span>
    </div>
  );
}

/**
 * The report's line and its code (step 33d2): what it holds; "Sending…"; the support code beside
 * the name, with a line saying what to do with it; or why it failed, in the warning colour.
 */
export function reportText(t: Translate, state: ReportState): { hint: string; code: string | null; warn: boolean } {
  if (state.state === 'sending') return { hint: t('settings.reportSending'), code: null, warn: false };
  if (state.state === 'sent') return { hint: t('settings.reportSent'), code: state.code, warn: false };
  if (state.state === 'failed') return { hint: t('settings.reportFailed'), code: null, warn: true };
  return { hint: t('settings.reportHint'), code: null, warn: false };
}

/** "Send a report to support" (step 33d2): OK sends it, then its support code shows beside the name, left to right in both languages. */
export function ReportItem({ i18n, item, report }: { i18n: AppI18n; item: ItemBinding; report: ReportRow }) {
  const { t } = i18n;
  const state = report.state.value;
  const text = reportText(t, state);
  return (
    <div
      class={rowClass('settings__row settings__switch', item)}
      role="menuitem"
      aria-busy={state.state === 'sending' ? 'true' : undefined}
      data-testid="settings-report"
      data-state={item.state}
      data-report={state.state}
      onMouseMove={item.onHover}
      onClick={item.onPress}
    >
      <div class="settings__top">
        <span class="settings__name">{t('settings.report')}</span>
        {text.code !== null && (
          <span class="settings__value settings__code" dir="ltr" translate={false} data-testid="settings-report-code">
            {text.code}
          </span>
        )}
      </div>
      <span class={text.warn ? 'settings__hint settings__warn' : 'settings__hint'} data-testid="settings-report-hint">
        {text.hint}
      </span>
    </div>
  );
}

/**
 * The settings screen as drawn, hook-free (the rows' bindings come from `SettingsPage`): the
 * `SETTINGS_VISIBLE` rows from `top`, the focus engine's window (step 38c1).
 */
export function SettingsView({
  i18n,
  list,
  item,
  telemetry,
  report = null,
  top = 0,
}: {
  i18n: AppI18n;
  list: readonly SettingsItem[];
  item: (index: number) => ItemBinding;
  telemetry: TelemetrySwitch | null;
  report?: ReportRow | null;
  top?: number;
}) {
  const { t } = i18n;
  const { from, to } = listWindow(top, list.length, SETTINGS_VISIBLE);
  return (
    <div class="settings__page" data-testid="settings">
      <header class="settings__header">
        <h1 class="settings__title">{t('settings.title')}</h1>
      </header>
      <div class="settings__items" role="menu" data-top={from} data-count={list.length}>
        {list.slice(from, to).map((id, n) => {
          const i = from + n;
          const binding = item(i);
          if (id === 'telemetry' && telemetry !== null) return <TelemetryRow key={id} i18n={i18n} item={binding} telemetry={telemetry} />;
          if (id === 'report' && report !== null) return <ReportItem key={id} i18n={i18n} item={binding} report={report} />;
          const text = itemText(t, id);
          return (
            <div key={id} class={rowClass('settings__row', binding)} role="menuitem" data-testid={`settings-${id}`} data-state={binding.state} onMouseMove={binding.onHover} onClick={binding.onPress}>
              <span class="settings__name">{text.name}</span>
              {/* "Language" (step 38d2): each language's own name in its language and direction. */}
              <span class="settings__hint">{id === 'language' ? languageNames() : text.hint}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The settings' list: on top, or under "Language"'s dialog (`screen`, step 38d2). */
function SettingsPage({ i18n, binding, list, telemetry, report, screen }: Omit<PageProps, 'focus'> & { list: readonly SettingsItem[]; telemetry: TelemetrySwitch | null; report: ReportRow | null; screen: Screen }) {
  const items = useZone(binding, screen, 'items');
  return <SettingsView i18n={i18n} list={list} item={(i) => items.item(i)} telemetry={telemetry} report={report} top={items.position.top} />;
}

/** The guide menu's buttons in words ("Give its link": step 32d4c). */
export function menuLabels(t: Translate): Record<GuideAction, string> {
  return { link: t('guides.giveLink'), up: t('guides.moveUp'), down: t('guides.moveDown'), offset: t('guides.offset'), matches: t('guides.matches'), remove: t('guides.remove'), cancel: t('action.cancel') };
}

function MenuDialog({ i18n, binding, menu }: { i18n: AppI18n; binding: FocusBinding; menu: GuidesMenu }) {
  const { t } = i18n;
  const zone = useZone(binding, binding.nav.top, 'actions');
  const labels = menuLabels(t);
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

/** A guide's matches (step 24c), from its summary: the rate, then a line per count. */
function MatchesDialog({ i18n, binding, row }: { i18n: AppI18n; binding: FocusBinding; row: GuideRow }) {
  const { t } = i18n;
  const zone = useZone(binding, binding.nav.top, 'actions');
  const summary = summaryOf(row);
  const rate = readText(i18n, row).matched;
  const body =
    summary === null ? null : (
      <div class="matches" data-testid="guide-matches-body">
        <p class="matches__rate" data-testid="guide-matches-rate">
          {rate}
        </p>
        <dl class="matches__lines">
          {matchLines(i18n, summary).map((line) => (
            <div key={line.id} class={`matches__line matches__line--${line.id}`} data-testid={`guide-matches-${line.id}`} data-n={line.n}>
              <dt class="matches__label">{line.label}</dt>
              <dd class="matches__value">{line.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  return (
    <Dialog title={t('guides.matches')} message={t('guides.menuLink', { link: row.link })} body={body} testId="guide-matches">
      <Button label={t('action.close')} {...zone.item(0)} testId="guide-matches-close" />
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

/** The add form's words; with `linking` (step 32d4c), a guide's link given again: its host as the hint, "Save". */
export function addFormText(t: Translate, linking: GuideRow | null): { title: string; body: string; hint: string; confirm: string } {
  const anyLink = t('field.linkHint', { http: NAMES.http, https: NAMES.https });
  if (linking === null) return { title: t('guides.addTitle'), body: t('guides.addBody', { format: NAMES.guide }), hint: anyLink, confirm: t('guides.addConfirm') };
  return { title: t('guides.linkTitle'), body: t('guides.linkBody'), hint: linking.link === '' ? anyLink : t('sources.linkWas', { host: linking.link }), confirm: t('sources.save') };
}

/** The add form as drawn, hook-free: the link, then the confirm and "Cancel". */
export function AddFormView({ i18n, guides, field, action }: { i18n: AppI18n; guides: Guides; field: ItemBinding; action: (index: number) => ItemBinding }) {
  const { t } = i18n;
  const linking = guides.linking.value;
  const words = addFormText(t, linking);
  return (
    <Dialog title={words.title} message={words.body} testId="guide-add">
      <div class="guides__form" data-linking={linking === null ? '' : linking.epgSrc}>
        <TextField
          id={LINK_FIELD_ID}
          label={t('guides.link')}
          value={guides.text.value}
          kind="url"
          hint={words.hint}
          error={problemText(t, guides.problem.value)}
          onValue={(value) => guides.setText(value)}
          edit={guides.editor.field(LINK_FIELD_ID)}
          {...field}
          testId="guide-add-link"
        />
        <div class="guides__actions">
          <Button label={words.confirm} variant="primary" {...action(ADD_CONFIRM)} testId="guide-add-confirm" />
          <Button label={t('action.cancel')} {...action(ADD_CANCEL)} testId="guide-add-cancel" />
        </div>
      </div>
    </Dialog>
  );
}

function AddDialog({ i18n, binding, guides }: { i18n: AppI18n; binding: FocusBinding; guides: Guides }) {
  const screen = binding.nav.top;
  const field = useZone(binding, screen, 'field');
  const actions = useZone(binding, screen, 'actions');
  return <AddFormView i18n={i18n} guides={guides} field={field.item(0)} action={(i) => actions.item(i)} />;
}

function GuidesPage({ i18n, binding, focus, guides }: PageProps & { guides: Guides }) {
  const { t } = i18n;
  const screen = guides.screen.value;
  if (screen === null) return null;
  const header = useZone(binding, screen, 'header');
  const status = guides.status.value;
  const rows = guides.rows.value;
  const reading = guides.reading.value;
  const menu = guides.menu.value;
  const chooser = guides.chooser.value;
  const matches = guides.matches.value;
  const unmatched = guides.unmatched.value;
  return (
    <div class="settings__page" data-testid="guides" data-status={status} data-count={rows.length} data-reading={reading} data-unmatched={unmatched ?? ''}>
      <header class="settings__header">
        <h1 class="settings__title">{t('guides.title')}</h1>
        <div class="settings__end">
          <Button label={t('guides.add')} variant="primary" {...header.item(HEADER_ADD)} testId="guides-add" />
          <Button label={unmatchedLabel(i18n, unmatched)} {...header.item(HEADER_UNMATCHED)} testId="guides-unmatched" />
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
      {chooser !== null && <OffsetDialog i18n={i18n} binding={binding} chooser={chooser} />}
      {matches !== null && <MatchesDialog i18n={i18n} binding={binding} row={matches} />}
      {focus.screen === 'guide-add' && <AddDialog i18n={i18n} binding={binding} guides={guides} />}
    </div>
  );
}

export function UnmatchedItem({ i18n, list, index, item }: { i18n: AppI18n; list: UnmatchedList; index: number; item: ItemBinding }) {
  const { t } = i18n;
  const row = list.row(index);
  const off = row !== null && list.noGuide(row.key);
  return (
    <div
      class={rowClass('unmatched__row', item)}
      role="option"
      aria-selected={item.state === 'focused' ? 'true' : 'false'}
      data-testid={`unmatched-${index}`}
      data-state={item.state}
      data-key={row === null ? '' : row.key}
      data-src={row === null ? '' : row.src}
      data-off={String(off)}
      onMouseMove={item.onHover}
      onClick={item.onPress}
    >
      {row !== null && (
        <span class="unmatched__name" dir="auto" translate={false}>
          {row.name}
        </span>
      )}
      {row !== null && (
        <span class="unmatched__where">
          <span class="unmatched__source">{t('guides.from', { name: list.sourceName(row.src) })}</span>
          {' · '}
          {row.category === '' ? (
            <span class="unmatched__category">{t('live.noGroup')}</span>
          ) : (
            <span class="unmatched__category" dir="auto" translate={false}>
              {row.category}
            </span>
          )}
          {off && ' · '}
          {off && (
            <span class="unmatched__off" data-testid={`unmatched-${index}-off`}>
              {t('unmatched.noGuide')}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/**
 * "Channels without a guide" (step 24c): the live channels no guide matches, read a page at a
 * time; "Reading the guides…" while a mapping's refresh runs (`reading`, step 24e).
 */
export function UnmatchedPage({ i18n, binding, list, reading }: { i18n: AppI18n; binding: FocusBinding; list: UnmatchedList; reading: number }) {
  const { t } = i18n;
  const screen = list.screen.value;
  if (screen === null) return null;
  const status = list.status.value;
  const count = list.count.value;
  // (Read so that new rows draw the list again: the rows come from `row()`.)
  const drawn = list.drawn.value;
  return (
    <div class="settings__page" data-testid="unmatched" data-status={status} data-count={count} data-drawn={drawn} data-reading={reading}>
      <header class="settings__header">
        <h1 class="settings__title">{t('unmatched.title')}</h1>
        <MappingReading i18n={i18n} reading={reading} testId="unmatched-reading" />
        {status === 'ready' && (
          <span class="unmatched__count" data-testid="unmatched-count" data-n={count}>
            {t('live.channels', { n: count })}
          </span>
        )}
      </header>
      <p class="guides__intro">{t('unmatched.intro')}</p>
      {status === 'loading' && (
        <div class="settings__message">
          <Spinner size="l" testId="unmatched-spinner" />
        </div>
      )}
      {status === 'failed' && (
        <div class="settings__message" data-testid="unmatched-failed">
          <p class="settings__text">{t('unmatched.failed')}</p>
        </div>
      )}
      {status === 'ready' && count === 0 && (
        <div class="settings__message" data-testid="unmatched-none">
          <p class="settings__text">{t('unmatched.none')}</p>
        </div>
      )}
      {/* (A count comes only with a ready list.) */}
      {count > 0 && (
        <VirtualList
          binding={binding}
          screen={screen}
          zone="channels"
          itemSize={UNMATCHED.rowHeight}
          gap={UNMATCHED.rowGap}
          class="unmatched__list"
          testId="unmatched-list"
          renderItem={(i, item) => <UnmatchedItem i18n={i18n} list={list} index={i} item={item} />}
        />
      )}
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
  const mapping = settings.mapping;
  const onGuides = focus.screen === 'guides' || focus.screen === 'guide-menu' || focus.screen === 'guide-offset' || focus.screen === 'guide-matches' || focus.screen === 'guide-add';
  const backup = settings.backup;
  const groups = settings.groups;
  const onChannels = focus.screen === GROUP_CHANNELS || focus.screen === CHANNEL_MENU;
  // "Channels" (step 36c), and "Edit channel" over it (opened over the player, main paints it there).
  const onEdited = focus.screen === CHANNELS_SCREEN || (EDIT_SCREENS.indexOf(focus.screen) !== -1 && !settings.channel.over.value);
  const parental = settings.parental;
  const checking = parental === null ? null : parental.check.form.source.value;
  // "Language"'s dialog (step 38d2) over the settings' list.
  const language = settings.language;
  const underLanguage = language === null || focus.screen !== LANGUAGE_SCREEN ? null : language.under.value;
  // (One slot for the list either way: the dialog's opening keeps it mounted.)
  const listScreen = focus.screen === 'settings' ? binding.nav.top : underLanguage;
  return (
    <main
      class="settings"
      data-testid="settings-screen"
      data-ready="true"
      data-language={i18n.locale.pseudo ? 'pseudo' : i18n.locale.language}
      data-pending={guides.pending.value + settings.unmatched.pending.value + mapping.pending.value + settings.sources.pending.value + (backup === null ? 0 : backup.pending.value) + (settings.telemetry === null ? 0 : settings.telemetry.pending.value) + (settings.report === null ? 0 : settings.report.pending.value) + (settings.connection === null ? 0 : settings.connection.pending.value) + groups.pending.value + settings.channel.pending.value + settings.channels.pending.value + (parental === null ? 0 : parental.pending.value + parental.check.pending.value)}
      data-editing={guides.editor.editing.value ?? mapping.editor.editing.value ?? settings.sources.form?.editor.editing.value ?? settings.sources.add?.editor.editing.value ?? groups.editor.editing.value ?? settings.channel.editor.editing.value ?? parental?.check.form.editor.editing.value ?? ''}
      data-screen={focus.screen}
      data-zone={focus.zone}
      data-index={focus.index}
      data-pointer={String(focus.pointer)}
      data-dir={focus.dir}
    >
      {listScreen !== null && <SettingsPage i18n={i18n} binding={binding} list={settings.items} telemetry={settings.telemetry} report={settings.report} screen={listScreen} />}
      {underLanguage !== null && language !== null && <LanguageDialog i18n={i18n} binding={binding} languages={language.languages} />}
      {onGuides && <GuidesPage i18n={i18n} binding={binding} focus={focus} guides={guides} />}
      {focus.screen === 'unmatched' && <UnmatchedPage i18n={i18n} binding={binding} list={settings.unmatched} reading={mapping.reading.value} />}
      {focus.screen === MAPPING_SCREEN && <MappingPage i18n={i18n} binding={binding} mapping={mapping} />}
      {(focus.screen === SOURCES_SCREEN || focus.screen === LOGIN_SCREEN || focus.screen === SOURCE_MENU || focus.screen === SOURCE_REMOVE || focus.screen === ADD_SCREEN) && <SourcesPage i18n={i18n} binding={binding} focus={focus} list={settings.sources} />}
      {focus.screen === PAIR_SCREEN && settings.pairing !== null && <PairPage pairing={settings.pairing} binding={binding} i18n={i18n} />}
      {(focus.screen === BACKUP_SCREEN || focus.screen === BACKUP_CONFIRM) && backup !== null && <BackupPageScreen i18n={i18n} binding={binding} focus={focus} page={backup} />}
      {!onChannels && GROUP_SCREENS.indexOf(focus.screen) !== -1 && <GroupsPage i18n={i18n} binding={binding} focus={focus} groups={groups} />}
      {onChannels && <ChannelsPage i18n={i18n} binding={binding} focus={focus} groups={groups} />}
      {onEdited && <EditedPage i18n={i18n} binding={binding} focus={focus} settings={settings} />}
      {parental !== null && PARENTAL_SCREENS.indexOf(focus.screen) !== -1 && <ParentalPageScreen i18n={i18n} binding={binding} focus={focus} page={parental} />}
      {parental !== null && focus.screen === CHECK_SCREEN && checking !== null && <LoginDialog i18n={i18n} binding={binding} form={parental.check.form} source={checking} />}
      {settings.player !== null && focus.screen === PLAYER_SETTINGS_SCREEN && <PlayerSettingsPage i18n={i18n} binding={binding} page={settings.player} />}
      {settings.connection !== null && focus.screen === CONNECTION_SCREEN && <ConnectionPage i18n={i18n} binding={binding} check={settings.connection} />}
      {focus.screen === HELP_SCREEN && <HelpListPage i18n={i18n} binding={binding} />}
      {focus.screen === HELP_TOPIC_SCREEN && <HelpTopicPage i18n={i18n} binding={binding} page={settings.help} />}
      {focus.screen === ABOUT_SCREEN && <AboutListPage i18n={i18n} binding={binding} />}
      {focus.screen === ABOUT_INFO_SCREEN && <AboutInfoPage i18n={i18n} binding={binding} page={settings.about} />}
      {focus.screen === ABOUT_DOC_SCREEN && <AboutDocPage i18n={i18n} binding={binding} page={settings.about} />}
      {settings.connection !== null && focus.screen === TEST_SCREEN && <TestStreamPage i18n={i18n} binding={binding} check={settings.connection} />}
    </main>
  );
}
