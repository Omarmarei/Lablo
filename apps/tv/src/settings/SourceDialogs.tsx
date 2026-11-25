import type { FocusBinding, Screen } from '@lablo/ui';
import { Button, Dialog, ProgressBar, Spinner, TextField, useZone } from '@lablo/ui';
import type { AppI18n } from '../i18n';
import type { FieldId, FieldProblem, SourceType } from '../onboarding/form';
import { errorText, phaseText, refusalText } from '../onboarding/load-text';
import type { AddAction, AddForm } from './source-add';
import { ADD_TYPES, addFieldId, fieldKind } from './source-add';
import type { SourceMenu, SourceRemoval, SourcesList } from './sources-state';

/**
 * What the sources screen draws over itself or in its place (RELAY step 40f): the header's
 * buttons, a row's menu, the removal's confirm, and the "Add a source" page. The states are
 * `sources-state.ts` and `source-add.ts`; every text comes from the catalogs.
 */

type Translate = AppI18n['t'];

/** Technical names shown inside sentences: never translated (arguments, so they are isolated). */
const NAMES = { guide: 'XMLTV', xtream: 'Xtream', m3u: 'M3U', http: 'http://', https: 'https://' } as const;

/** The header's buttons: "Add from your phone" (step 31c2a) when the app can pair, then "Add a source". A hook of its own: the zone exists only when one of them does. */
export function SourcesHeader({ i18n, binding, screen, list }: { i18n: AppI18n; binding: FocusBinding; screen: Screen; list: SourcesList }) {
  const header = useZone(binding, screen, 'header');
  const first = list.phone ? 1 : 0;
  return (
    <div class="settings__end sources__header">
      {list.phone && <Button label={i18n.t('sources.addPhone')} variant="primary" {...header.item(0)} testId="sources-add-phone" />}
      {list.add !== null && <Button label={i18n.t('sources.add')} variant={list.phone ? 'secondary' : 'primary'} {...header.item(first)} testId="sources-add" />}
    </div>
  );
}

/** A row's menu: what can be done to the source (step 40f). */
export function SourceMenuDialog({ i18n, binding, menu }: { i18n: AppI18n; binding: FocusBinding; menu: SourceMenu }) {
  const { t } = i18n;
  const zone = useZone(binding, binding.nav.top, 'actions');
  const labels = { edit: menu.row.type === 'xtream' ? t('sources.editLogin') : t('sources.editLink'), remove: t('sources.remove'), cancel: t('action.cancel') };
  return (
    <Dialog title={t('sources.menuTitle', { name: menu.row.name })} message={t('sources.menuLine', { name: menu.row.name })} testId="source-menu">
      <div class="guides__menu">
        {menu.actions.map((action, i) => (
          <Button key={action} label={labels[action]} variant={action === 'remove' ? 'danger' : 'secondary'} {...zone.item(i)} testId={`source-menu-${action}`} />
        ))}
      </div>
    </Dialog>
  );
}

/** The removal's confirm: what goes with the source, the favourites counted. "Cancel" has the focus. */
export function SourceRemoveDialog({ i18n, binding, removing }: { i18n: AppI18n; binding: FocusBinding; removing: SourceRemoval }) {
  const { t } = i18n;
  const zone = useZone(binding, binding.nav.top, 'actions');
  return (
    <Dialog title={t('sources.removeTitle', { name: removing.row.name })} message={t('sources.removeBody', { n: removing.favourites })} testId="source-remove">
      <div class="guides__actions">
        <Button label={t('sources.remove')} variant="danger" {...zone.item(0)} testId="source-remove-confirm" />
        <Button label={t('action.cancel')} {...zone.item(1)} testId="source-remove-cancel" />
      </div>
    </Dialog>
  );
}

function fieldLabel(t: Translate, id: FieldId): string {
  if (id === 'server') return t('field.server');
  if (id === 'username') return t('field.username');
  if (id === 'password') return t('field.password');
  if (id === 'playlist') return t('field.playlist');
  if (id === 'epg') return t('field.epg');
  return t('field.name');
}

function fieldHint(t: Translate, id: FieldId): string | undefined {
  if (id === 'server') return t('field.serverHint', { scheme: NAMES.http });
  if (id === 'playlist') return t('field.linkHint', { http: NAMES.http, https: NAMES.https });
  if (id === 'epg') return t('field.epgHint', { format: NAMES.guide });
  if (id === 'name') return t('field.nameHint');
  return undefined;
}

function problemText(t: Translate, problem: FieldProblem | undefined): string | null {
  if (problem === 'required') return t('field.required');
  if (problem === 'url') return t('field.url', { http: NAMES.http, https: NAMES.https });
  if (problem === 'spaces') return t('field.spaces');
  return null;
}

function typeLabel(t: Translate, type: SourceType): string {
  return type === 'xtream' ? t('sources.xtream', { name: NAMES.xtream }) : t('sources.m3u', { format: NAMES.m3u });
}

function actionLabel(t: Translate, action: AddAction): string {
  if (action === 'add') return t('onboarding.add');
  if (action === 'cancel') return t('action.cancel');
  if (action === 'edit') return t('loading.edit');
  if (action === 'retry') return t('loading.retry');
  if (action === 'pin') return t('parental.set');
  if (action === 'later') return t('done.later');
  return t('pair.done');
}

/** The counts of a finished add, as onboarding's done screen lists them. */
function DoneCounts({ i18n, add }: { i18n: AppI18n; add: AddForm }) {
  const { t } = i18n;
  const result = add.result.value;
  if (result === null) return null;
  return (
    <div data-testid="source-add-done">
      <p class="settings__hint">{t('done.body', { name: add.name.value })}</p>
      <ul class="sources__counts">
        <li data-testid="source-add-live" data-n={result.live}>
          {t('done.live', { n: result.live })}
        </li>
        <li data-testid="source-add-movies" data-n={result.movies}>
          {t('done.movies', { n: result.movies })}
        </li>
        <li data-testid="source-add-series" data-n={result.series}>
          {t('done.series', { n: result.series })}
        </li>
      </ul>
      {add.actions().indexOf('pin') !== -1 && (
        <p class="settings__hint" data-testid="source-add-pin-note">
          {t('done.pinNote')}
        </p>
      )}
    </div>
  );
}

/** What the page says for each view but the form: the load's progress, why it failed or was refused, the counts. */
function AddBody({ i18n, add }: { i18n: AppI18n; add: AddForm }) {
  const { t } = i18n;
  const view = add.view.value;
  if (view === 'done') return <DoneCounts i18n={i18n} add={add} />;
  if (view === 'refused') {
    const refusal = add.refusal.value;
    return (
      <p class="settings__hint" data-testid="source-add-refused">
        {refusal === null ? t('error.refused') : refusalText(i18n, refusal)}
      </p>
    );
  }
  if (view === 'failed') {
    const failure = add.failure.value;
    return (
      <p class="settings__hint settings__warn" data-testid="source-add-failed" data-code={failure === null ? '' : failure.code}>
        {t('loading.failed', { name: add.name.value })}
        {failure !== null && ' '}
        {failure !== null && errorText(t, failure.code, failure.status)}
      </p>
    );
  }
  const progress = add.progress.value;
  const phase = progress === null ? 'checking' : progress.phase;
  const status = phaseText(t, phase, progress === null ? 0 : progress.items);
  const fraction = progress !== null && progress.total !== null && progress.total > 0 ? progress.bytes / progress.total : null;
  return (
    <div>
      <div class="sources__progress">
        <Spinner size="m" label={status} />
        <p class="settings__hint" data-testid="source-add-status" data-phase={phase} data-items={progress === null ? 0 : progress.items}>
          {status}
        </p>
      </div>
      <ProgressBar value={fraction === null ? 0 : fraction} label={status} testId="source-add-progress" />
    </div>
  );
}

/** "Add a source" (step 40f): in the sources page's place, the form, then the load's views. */
export function SourceAddPage({ i18n, binding, screen, add }: { i18n: AppI18n; binding: FocusBinding; screen: Screen; add: AddForm }) {
  const { t } = i18n;
  const types = useZone(binding, screen, 'type');
  const fields = useZone(binding, screen, 'fields');
  const actions = useZone(binding, screen, 'actions');
  const view = add.view.value;
  const type = add.type.value;
  const values = add.values.value;
  const problems = add.problems.value;
  const list = add.actions();
  return (
    <div class="settings__page" data-testid="source-add" data-view={view} data-type={type}>
      <header class="settings__header">
        <h1 class="settings__title">{view === 'loading' ? t('loading.title', { name: add.name.value }) : view === 'done' ? t('done.title') : t('sources.addTitle')}</h1>
      </header>
      {view === 'form' ? (
        <div class="guides__form sources__form">
          <p class="guides__intro">{t('onboarding.typeHint')}</p>
          <div class="sources__types" role="group">
            {ADD_TYPES.map((kind, i) => (
              <Button key={kind} label={typeLabel(t, kind)} variant={kind === type ? 'primary' : 'secondary'} {...types.item(i)} testId={`source-add-type-${kind}`} />
            ))}
          </div>
          <div class="sources__fields">
          {add.fields().map((id, i) => (
            <TextField
              key={type + id}
              id={addFieldId(id)}
              label={fieldLabel(t, id)}
              value={values[id] ?? ''}
              kind={fieldKind(id)}
              hint={fieldHint(t, id)}
              error={problemText(t, problems[id])}
              onValue={(value) => add.setValue(id, value)}
              edit={add.editor.field(addFieldId(id))}
              {...fields.item(i)}
              testId={`source-add-${id}`}
            />
          ))}
          </div>
        </div>
      ) : (
        <AddBody i18n={i18n} add={add} />
      )}
      <div class="guides__actions">
        {list.map((action, i) => (
          <Button
            key={action}
            label={actionLabel(t, action)}
            variant={action === 'add' || action === 'pin' || action === 'done' || action === 'retry' ? 'primary' : 'secondary'}
            {...actions.item(i)}
            testId={`source-add-${action}`}
          />
        ))}
      </div>
    </div>
  );
}
