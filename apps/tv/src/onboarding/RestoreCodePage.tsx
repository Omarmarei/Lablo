import { BACKUP_CODE_LENGTH } from '@lablo/crypto/backup-code';
import type { EditorBinding, FieldEditing, FocusBinding, ZoneView } from '@lablo/ui';
import { Button, ProgressBar, Spinner, TextField, useZone } from '@lablo/ui';
import type { AppI18n } from '../i18n';
import type { CodeProblem, RestoreCode, RestoreNotice, RestorePhase } from './restore-code';
import { CODE_ACTIONS, CODE_FIELD, CODE_ZONE } from './restore-code';

/**
 * "Restore with a backup code" (RELAY step 32d3c), in onboarding's panel. Every text comes from
 * the catalogs; the code is the user's own text, drawn left to right in both languages (the
 * field's `dir="ltr"`). Settings' and Backup's names are arguments, so they are isolated in Arabic.
 */

type Translate = AppI18n['t'];

/** What a field problem says. */
export function codeProblemText(t: Translate, problem: CodeProblem | null): string | null {
  if (problem === 'required') return t('restore.required');
  if (problem === 'length') return t('restore.length', { n: BACKUP_CODE_LENGTH });
  if (problem === 'invalid') return t('restore.invalid');
  return null;
}

/** What an answer that wasn't a restore says (Settings' restore texts where they fit). */
export function restoreNoticeText(t: Translate, notice: RestoreNotice): string {
  if (notice === 'none') return t('restore.none');
  if (notice === 'newer') return t('backup.restoreNewer');
  if (notice === 'network') return t('backup.restoreFailed');
  if (notice === 'rate') return t('restore.rate');
  if (notice === 'status') return t('restore.status');
  return t('backup.restoreOther');
}

export interface RestoreCodeContentProps {
  readonly i18n: AppI18n;
  readonly phase: RestorePhase;
  readonly text: string;
  readonly problem: CodeProblem | null;
  readonly notice: RestoreNotice | null;
  readonly progress: number | null;
  readonly field: ZoneView;
  readonly actions: ZoneView;
  readonly edit: FieldEditing;
  readonly onValue: (value: string) => void;
}

/** The screen as drawn: hook-free (the tests call it as a function). */
export function RestoreCodeContent({ i18n, phase, text, problem, notice, progress, field, actions, edit, onValue }: RestoreCodeContentProps) {
  const { t } = i18n;
  const attrs = {
    class: 'onboarding__panel',
    'data-testid': 'restore-code',
    'data-phase': phase,
    'data-problem': problem ?? '',
    'data-notice': notice ?? '',
    'data-progress': progress === null ? '' : String(progress),
  };
  if (phase !== 'typing') {
    const title = t('restore.opening');
    return (
      <div {...attrs}>
        <h1 class="onboarding__title" data-testid="onboarding-title">
          {title}
        </h1>
        <p class="onboarding__text">{t('restore.openingBody')}</p>
        <div class="onboarding__progress">
          <Spinner size="m" label={title} />
        </div>
        <ProgressBar value={progress ?? 0} label={title} class="onboarding__bar" testId="restore-progress" />
        <div class="onboarding__actions">
          <Button label={t('action.cancel')} {...actions.item(0)} testId="action-0" />
        </div>
      </div>
    );
  }
  return (
    <div {...attrs}>
      <h1 class="onboarding__title" data-testid="onboarding-title">
        {t('restore.title')}
      </h1>
      <p class="onboarding__text">{t('restore.body', { backup: t('settings.backup'), settings: t('settings.title'), n: BACKUP_CODE_LENGTH })}</p>
      <div class="onboarding__fields">
        <TextField
          id={CODE_FIELD}
          label={t('restore.field')}
          value={text}
          dir="ltr"
          hint={t('restore.fieldHint')}
          error={codeProblemText(t, problem)}
          onValue={onValue}
          edit={edit}
          {...field.item(0)}
          testId="field-code"
        />
      </div>
      {notice !== null && (
        <p class="onboarding__text onboarding__error onboarding__notice" role="alert" data-testid="restore-notice" data-notice={notice}>
          {restoreNoticeText(t, notice)}
        </p>
      )}
      <div class="onboarding__actions onboarding__actions--form">
        <Button label={t('backup.restoreConfirm')} variant="primary" {...actions.item(0)} testId="action-0" />
      </div>
    </div>
  );
}

export function RestoreCodePage({ restore, binding, editor, i18n }: { restore: RestoreCode; binding: FocusBinding; editor: EditorBinding; i18n: AppI18n }) {
  const screen = binding.nav.top;
  const field = useZone(binding, screen, CODE_ZONE);
  const actions = useZone(binding, screen, CODE_ACTIONS);
  return (
    <RestoreCodeContent
      i18n={i18n}
      phase={restore.phase.value}
      text={restore.text.value}
      problem={restore.problem.value}
      notice={restore.notice.value}
      progress={restore.progress.value}
      field={field}
      actions={actions}
      edit={editor.field(CODE_FIELD)}
      onValue={(value) => restore.setText(value)}
    />
  );
}
