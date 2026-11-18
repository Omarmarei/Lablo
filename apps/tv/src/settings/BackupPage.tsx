import type { ComponentChildren } from 'preact';
import type { BackupStatus, BackupUploadResult } from '@lablo/data';
import type { Focus, FocusBinding, ItemBinding } from '@lablo/ui';
import { Button, Dialog, Spinner, useZone } from '@lablo/ui';
import type { AppI18n } from '../i18n';
import type { BackupBusy, BackupNotice, BackupPage, BackupQuestion } from './backup-state';
import { BACKUP_CONFIRM, CONFIRM_NO, CONFIRM_YES, HELD_REPLACE, HELD_RESTORE, codeGroups, showsHeld } from './backup-state';

/**
 * Settings' backup page (RELAY step 32d2b, `backup-state.ts`): the switch row and its line, the
 * backup code in groups of four while it is the secret (data: left to right, never translated),
 * a held backup's box, what an action that didn't work says, and the confirm dialog over them.
 * Every text comes from the catalogs.
 */

type Translate = AppI18n['t'];

function rowClass(base: string, item: ItemBinding): string {
  return item.state === 'focused' ? `${base} is-focused` : item.state === 'memory' ? `${base} is-memory` : base;
}

/**
 * The line under the switch: what is running, else the session's last run when it didn't send
 * (a failure, too large), else when the copy on the server was last written; off, whether its
 * copy is still to delete.
 */
export function switchLine(i18n: AppI18n, info: BackupStatus, last: BackupUploadResult | null, busy: BackupBusy | null): string {
  const { t } = i18n;
  if (busy === 'off') return t('backup.turningOff');
  if (busy === 'on') return t('backup.turningOn');
  if (!info.on) return info.deleting ? t('backup.offDeleting') : t('backup.offNothing');
  if (last !== null && last.state === 'failed') return t('backup.sendFailed');
  if (last !== null && last.state === 'too-large') return t('backup.tooLarge');
  if (info.sentAt === null) return t('backup.notSent');
  const at = new Date(info.sentAt);
  return t('backup.sentAt', { day: i18n.date(at, 'day'), time: i18n.time(at) });
}

/** What an action that didn't work says. */
export function noticeText(t: Translate, notice: BackupNotice): string {
  if (notice === 'off-failed') return t('backup.offFailed');
  if (notice === 'on-failed') return t('backup.onFailed');
  if (notice === 'replace-failed') return t('backup.replaceFailed');
  if (notice === 'restore-failed') return t('backup.restoreFailed');
  if (notice === 'restore-newer') return t('backup.restoreNewer');
  return t('backup.restoreOther');
}

/** The confirm dialog's words for each question; off and replace are the danger buttons. */
export function questionText(t: Translate, question: BackupQuestion): { title: string; body: string; confirm: string; danger: boolean } {
  if (question === 'off') return { title: t('backup.offTitle'), body: t('backup.offBody'), confirm: t('backup.offConfirm'), danger: true };
  if (question === 'restore') return { title: t('backup.restoreTitle'), body: t('backup.restoreBody'), confirm: t('backup.restoreConfirm'), danger: false };
  return { title: t('backup.replaceTitle'), body: t('backup.replaceBody'), confirm: t('backup.replaceConfirm'), danger: true };
}

/** The page as drawn, hook-free (the bindings and the dialog come from `BackupPageScreen`). */
export function BackupView({
  i18n,
  page,
  switchItem,
  heldItem,
  dialog = null,
}: {
  i18n: AppI18n;
  page: BackupPage;
  switchItem: ItemBinding;
  heldItem: (index: number) => ItemBinding;
  dialog?: ComponentChildren;
}) {
  const { t } = i18n;
  const status = page.status.value;
  const info = page.info.value;
  const busy = page.busy.value;
  const notice = page.notice.value;
  const held = showsHeld(info, page.held.value);
  const code = info !== null && info.on && info.code !== null ? info.code : null;
  return (
    <div
      class="settings__page"
      data-testid="backup"
      data-status={status}
      data-on={info === null ? '' : String(info.on)}
      data-source={info === null ? '' : info.source}
      data-sent={info === null || info.sentAt === null ? '' : info.sentAt}
      data-deleting={info === null ? '' : String(info.deleting)}
      data-held={String(held)}
      data-busy={busy ?? ''}
      data-notice={notice ?? ''}
    >
      <header class="settings__header">
        <h1 class="settings__title">{t('backup.title')}</h1>
      </header>
      <p class="guides__intro">{t('backup.intro')}</p>
      {status === 'loading' && (
        <div class="settings__message">
          <Spinner size="l" testId="backup-spinner" />
        </div>
      )}
      {status === 'failed' && (
        <div class="settings__message" data-testid="backup-failed">
          <p class="settings__text">{t('backup.failedRead')}</p>
        </div>
      )}
      {info !== null && (
        <div class="backup__body">
          <div
            class={rowClass('settings__row backup__switch', switchItem)}
            role="switch"
            aria-checked={info.on ? 'true' : 'false'}
            data-testid="backup-switch"
            data-state={switchItem.state}
            onMouseMove={switchItem.onHover}
            onClick={switchItem.onPress}
          >
            <div class="backup__top">
              <span class="settings__name">{t('backup.switch')}</span>
              <span class="backup__value" data-testid="backup-value">
                {info.on ? t('backup.on') : t('backup.off')}
              </span>
            </div>
            <span class="settings__hint" data-testid="backup-line">
              {switchLine(i18n, info, page.last.value, busy)}
            </span>
          </div>
          {code !== null && (
            <section class="backup__box" data-testid="backup-code-box">
              <h2 class="backup__heading">{t('backup.codeTitle')}</h2>
              <p class="backup__code" dir="ltr" translate={false} data-testid="backup-code" data-code={code}>
                {codeGroups(code)}
              </p>
              <p class="backup__text">{t('backup.codeBody')}</p>
            </section>
          )}
          {held && (
            <section class="backup__box" data-testid="backup-held">
              <h2 class="backup__heading">{t('backup.heldTitle')}</h2>
              <p class="backup__text">{t('backup.heldBody')}</p>
              <div class="backup__actions">
                <Button label={t('backup.restore')} variant="primary" disabled={busy !== null} {...heldItem(HELD_RESTORE)} testId="backup-restore" />
                <Button label={t('backup.replace')} disabled={busy !== null} {...heldItem(HELD_REPLACE)} testId="backup-replace" />
                {(busy === 'restore' || busy === 'replace') && (
                  <span class="backup__busy" data-testid="backup-busy">
                    {busy === 'restore' ? t('backup.restoring') : t('backup.replacing')}
                  </span>
                )}
              </div>
            </section>
          )}
          {notice !== null && (
            <p class="guides__failure backup__notice" data-testid="backup-notice">
              {noticeText(t, notice)}
            </p>
          )}
        </div>
      )}
      {dialog}
    </div>
  );
}

/** The confirm dialog as drawn, hook-free: the confirm first, then "Cancel" (focused first). */
export function BackupConfirmView({ i18n, question, item }: { i18n: AppI18n; question: BackupQuestion; item: (index: number) => ItemBinding }) {
  const { t } = i18n;
  const words = questionText(t, question);
  return (
    <Dialog title={words.title} message={words.body} testId="backup-confirm">
      <Button label={words.confirm} variant={words.danger ? 'danger' : 'primary'} {...item(CONFIRM_YES)} testId="backup-confirm-yes" />
      <Button label={t('action.cancel')} {...item(CONFIRM_NO)} testId="backup-confirm-no" />
    </Dialog>
  );
}

function BackupConfirm({ i18n, binding, question }: { i18n: AppI18n; binding: FocusBinding; question: BackupQuestion }) {
  const zone = useZone(binding, binding.nav.top, 'actions');
  return <BackupConfirmView i18n={i18n} question={question} item={(index) => zone.item(index)} />;
}

/** The backup page and its confirm dialog, on the page's own screen (the dialog covers it). */
export function BackupPageScreen({ i18n, binding, focus, page }: { i18n: AppI18n; binding: FocusBinding; focus: Focus; page: BackupPage }) {
  const screen = page.screen.value;
  if (screen === null) return null;
  const switches = useZone(binding, screen, 'switch');
  const held = useZone(binding, screen, 'held');
  const question = page.question.value;
  const dialog = focus.screen === BACKUP_CONFIRM && question !== null ? <BackupConfirm i18n={i18n} binding={binding} question={question} /> : null;
  return <BackupView i18n={i18n} page={page} switchItem={switches.item(0)} heldItem={(index) => held.item(index)} dialog={dialog} />;
}
