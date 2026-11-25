import type { VNode } from 'preact';
import type { SourceProbe } from '@lablo/data';
import { accountProblemCode } from '@lablo/player';
import type { FocusBinding, ItemBinding } from '@lablo/ui';
import { Button, useZone } from '@lablo/ui';
import type { AppI18n, MessageKey } from '../i18n';
import type { LastPlay } from '../player/last-play';
import { ACCOUNT_TEXT, CATEGORY_TEXT } from '../player/PlayerScreen';
import { containerName } from '../player/stream-info';
import type { ConnectionCheck, ConnectionState, ConnectionVerdict } from './connection-check';
import { connectionVerdict } from './connection-check';

/**
 * Settings › "Check the connection" as drawn (RELAY step 40a): the verdict first, in large type
 * ("Checking…" until every line is in); then a line for the internet, one per source (its name as
 * the provider wrote it) and one for the last stream, each its name, its answer at the end and a
 * line under it where there is more to say; then "Check again" and "Close". An account's problems
 * and the last stream's failure use the error card's words (`ACCOUNT_TEXT`, `CATEGORY_TEXT`).
 */

/** How a line reads: `ok`, `warn` (the warning colour), `info`, or `checking`. */
export type LineTone = 'ok' | 'warn' | 'info' | 'checking';

export interface LineText {
  readonly value: string;
  readonly detail: string | null;
  readonly tone: LineTone;
}

/** The verdicts' words: an account's problem says it as the error card does. */
const VERDICT_TEXT: Readonly<Record<ConnectionVerdict, MessageKey>> = {
  offline: 'connection.verdict.offline',
  app: 'connection.verdict.app',
  none: 'connection.verdict.none',
  'no-answer': 'connection.verdict.noAnswer',
  refused: 'player.account.refused',
  expired: 'player.account.expired',
  closed: 'player.account.blocked',
  full: 'player.account.full',
  provider: 'connection.verdict.provider',
  login: 'connection.verdict.login',
  device: 'connection.verdict.device',
  channel: 'connection.verdict.channel',
  ok: 'connection.verdict.ok',
};

/** Whether the TV, a source or the last stream answered well (`data-verdict`'s colour). */
function verdictTone(verdict: ConnectionVerdict | null): LineTone {
  return verdict === null ? 'checking' : verdict === 'ok' ? 'ok' : 'warn';
}

/** Seconds with one decimal, at least 0.1 (a fast answer never reads "0 s"). */
export function seconds(ms: number): number {
  return Math.max(1, Math.round(ms / 100)) / 10;
}

/** The internet's line: the TV's own flag, then whether any server answered. */
export function internetText(i18n: AppI18n, state: ConnectionState): LineText {
  const { t } = i18n;
  if (!state.online) return { value: t('connection.offline'), detail: null, tone: 'warn' };
  const lines = state.sources;
  if (lines === null || lines.some((l) => l.probe === null)) return { value: t('connection.checking'), detail: null, tone: 'checking' };
  const asked = lines.filter((l) => l.probe!.kind === 'answered' || l.probe!.kind === 'unreachable' || l.probe!.kind === 'timeout');
  if (asked.length > 0 && !asked.some((l) => l.probe!.kind === 'answered')) return { value: t('connection.noAnswer'), detail: null, tone: 'warn' };
  return { value: t('connection.online'), detail: null, tone: 'ok' };
}

/** A panel's account in words: its problem in the error card's words, else active (until when), and the connections in use. */
function accountText(i18n: AppI18n, probe: Extract<SourceProbe, { kind: 'answered' }>): { text: string; warn: boolean } {
  const { t } = i18n;
  const account = probe.account;
  if (account === null) return { text: t('connection.noAccount'), warn: true };
  const code = accountProblemCode(account);
  if (code !== null) return { text: t(ACCOUNT_TEXT[code]!), warn: true };
  const active = account.expDate === null ? t('connection.active') : t('connection.activeUntil', { date: i18n.date(new Date(account.expDate * 1000), 'full') });
  const max = account.maxConnections;
  if (max === null || max <= 0 || account.activeCons === null) return { text: active, warn: false };
  return { text: `${active} · ${t('player.account.connections', { active: account.activeCons, max })}`, warn: false };
}

/** A source's line: its server's answer, and the account or the playlist under it. */
export function sourceText(i18n: AppI18n, probe: SourceProbe | null): LineText {
  const { t } = i18n;
  if (probe === null) return { value: t('connection.checking'), detail: null, tone: 'checking' };
  if (probe.kind === 'file') return { value: t('connection.file'), detail: null, tone: 'info' };
  if (probe.kind === 'no-login') return { value: t('connection.noLogin'), detail: null, tone: 'warn' };
  if (probe.kind === 'blocked') return { value: t('error.blocklisted'), detail: null, tone: 'warn' };
  if (probe.kind === 'error') return { value: t('connection.failed'), detail: null, tone: 'warn' };
  if (probe.kind === 'unreachable') return { value: t('connection.unreachable'), detail: null, tone: 'warn' };
  if (probe.kind === 'timeout') return { value: t('connection.timeout', { n: 10 }), detail: null, tone: 'warn' };
  if (probe.status < 200 || probe.status >= 300) {
    // A panel that refused the login (401, 403) says so as the error card does.
    const refused = probe.account === null ? null : t('player.account.refused');
    return { value: t('connection.status', { status: probe.status }), detail: refused, tone: 'warn' };
  }
  const value = t('connection.answered', { seconds: seconds(probe.ms) });
  if (probe.playlist !== null) return probe.playlist ? { value, detail: null, tone: 'ok' } : { value, detail: t('connection.notPlaylist'), tone: 'warn' };
  const account = accountText(i18n, probe);
  return { value, detail: account.text, tone: account.warn ? 'warn' : 'ok' };
}

/** The last stream's line: none, played (its format and the time to the picture), or the error card's title and code. */
export function lastText(i18n: AppI18n, last: LastPlay | null): LineText {
  const { t } = i18n;
  if (last === null) return { value: t('connection.lastNone'), detail: null, tone: 'info' };
  if (last.state === 'played') return { value: t('connection.played', { format: containerName(last.container), seconds: seconds(last.ttffMs) }), detail: null, tone: 'ok' };
  const failure = last.failure;
  return { value: t(CATEGORY_TEXT[failure.category][0]), detail: t('player.code', { code: failure.code }), tone: 'warn' };
}

/** One line, a plain function (not a component: the view's tests read its markup whole). */
function lineView(name: string, text: LineText, testId: string, own: boolean): VNode {
  return (
    <div key={testId} class={`connection__line is-${text.tone}`} data-testid={testId} data-tone={text.tone}>
      <div class="connection__top">
        {/* A source's name is the provider's text, in its own direction. */}
        {own ? (
          <span class="connection__name" dir="auto" translate={false}>
            {name}
          </span>
        ) : (
          <span class="connection__name">{name}</span>
        )}
        <span class="connection__value" data-testid={`${testId}-value`}>
          {text.value}
        </span>
      </div>
      {text.detail !== null && (
        <span class="connection__detail" data-testid={`${testId}-detail`}>
          {text.detail}
        </span>
      )}
    </div>
  );
}

/** The page as drawn, hook-free (the buttons' bindings come from `ConnectionPage`). */
export function ConnectionView({ i18n, check, button }: { i18n: AppI18n; check: ConnectionCheck; button: (index: number) => ItemBinding }) {
  const { t } = i18n;
  const state = check.state.value;
  const verdict = connectionVerdict(state);
  const tone = verdictTone(verdict);
  const sources = state.sources ?? [];
  return (
    <div class="settings__page connection" data-testid="connection" data-verdict={verdict ?? ''}>
      <header class="settings__header">
        <h1 class="settings__title">{t('settings.connection')}</h1>
      </header>
      <p class={`connection__verdict is-${tone}`} role="status" aria-live="polite" data-testid="connection-verdict">
        {verdict === null ? t('connection.checking') : t(VERDICT_TEXT[verdict])}
      </p>
      <div class="connection__lines">
        {lineView(t('connection.internet'), internetText(i18n, state), 'connection-internet', false)}
        {sources.map((line, i) => lineView(line.name, sourceText(i18n, line.probe), `connection-source-${i}`, true))}
        {lineView(t('connection.last'), lastText(i18n, state.last), 'connection-last', false)}
      </div>
      <div class="connection__buttons">
        <Button label={t('connection.again')} variant="primary" {...button(0)} testId="connection-again" />
        <Button label={t('action.close')} {...button(1)} testId="connection-close" />
      </div>
    </div>
  );
}

export function ConnectionPage({ i18n, binding, check }: { i18n: AppI18n; binding: FocusBinding; check: ConnectionCheck }) {
  const buttons = useZone(binding, binding.nav.top, 'actions');
  return <ConnectionView i18n={i18n} check={check} button={(i) => buttons.item(i)} />;
}
