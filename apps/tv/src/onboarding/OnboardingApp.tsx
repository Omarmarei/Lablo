import type { ComponentChildren } from 'preact';
import type { Platform } from '@zoma/platform-api';
import type { Language, LocaleSettings } from '@zoma/ui';
import { Button, Dialog, ProgressBar, Spinner, TextField, connectRemote, resolveLocale, useFocus, useZone } from '@zoma/ui';
import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { AppI18n } from '../i18n';
import { LANGUAGE_NAMES, appI18n, switchedTag } from '../i18n';
import type { FieldId, FieldProblem } from './form';
import { FORM_FIELDS } from './form';
import type { LoadErrorCode, LoadPhase } from './loader';
import type { Onboarding } from './onboarding-state';
import { LANGUAGES, SOURCE_TYPES, fieldDomId } from './onboarding-state';
import './onboarding.css';

/**
 * Onboarding's screens (RELAY step 13a). Every text comes from the catalogs. Brand and format
 * names, `http://` and the user's own text are arguments, so the runtime isolates them in Arabic.
 */

/** Technical names shown inside sentences: never translated (arguments, so they are isolated). */
const NAMES = { name: 'Xtream', format: 'M3U', guide: 'XMLTV', http: 'http://', https: 'https://' } as const;

type Translate = AppI18n['t'];

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

function errorText(t: Translate, code: LoadErrorCode, status: number | null): string {
  if (code === 'http') return t('error.http', { status: status ?? 0 });
  if (code === 'auth') return t('error.auth');
  if (code === 'expired') return t('error.expired');
  if (code === 'blocked') return t('error.blocked');
  if (code === 'network') return t('error.network');
  if (code === 'format') return t('error.format');
  if (code === 'empty') return t('error.empty');
  return t('error.other');
}

function phaseText(t: Translate, phase: LoadPhase, items: number): string {
  if (phase === 'checking') return t('loading.checking');
  if (phase === 'saving') return t('loading.saving');
  if (phase === 'guide') return t('loading.guide');
  return t('loading.download', { n: items });
}

function Panel({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <div class="onboarding__panel">
      <h1 class="onboarding__title" data-testid="onboarding-title">
        {title}
      </h1>
      {children}
    </div>
  );
}

interface ScreenProps {
  readonly ob: Onboarding;
  readonly i18n: AppI18n;
}

/** Both languages' own words, the TV's first: nobody has picked a language yet. */
function LanguageScreen({ ob, device }: { ob: Onboarding; device: AppI18n }) {
  const zone = useZone(ob.binding, ob.home, 'languages');
  const first = device.locale.language;
  const titles: Array<[Language, string]> = [
    [first, device.t('onboarding.chooseLanguage')],
    [first === 'ar' ? 'en' : 'ar', appI18n(first === 'ar' ? 'en' : 'ar').t('onboarding.chooseLanguage')],
  ];
  return (
    <div class="onboarding__panel onboarding__panel--center">
      {titles.map(([language, title], i) => (
        // The second one is in the other language on purpose: never translated.
        <h1
          key={language}
          class={i === 0 ? 'onboarding__title' : 'onboarding__title onboarding__title--second'}
          lang={language}
          dir={language === 'ar' ? 'rtl' : 'ltr'}
          translate={i === 0 ? undefined : false}
          data-testid={`choose-${language}`}
        >
          {title}
        </h1>
      ))}
      <div class="onboarding__actions">
        {LANGUAGES.map((language, i) => (
          <Button key={language} label={LANGUAGE_NAMES[language]} lang={language} {...zone.item(i)} testId={`language-${language}`} />
        ))}
      </div>
    </div>
  );
}

function DisclaimerScreen({ ob, i18n }: ScreenProps) {
  const { t } = i18n;
  const zone = useZone(ob.binding, ob.binding.nav.top, 'actions');
  return (
    <Panel title={t('onboarding.disclaimerTitle')}>
      <p class="onboarding__text">{t('onboarding.disclaimerBody')}</p>
      <p class="onboarding__text">{t('onboarding.disclaimerAdd')}</p>
      <div class="onboarding__actions">
        <Button label={t('onboarding.understand')} variant="primary" {...zone.item(0)} testId="action-0" />
      </div>
    </Panel>
  );
}

function ConsentScreen({ ob, i18n }: ScreenProps) {
  const { t } = i18n;
  const zone = useZone(ob.binding, ob.binding.nav.top, 'actions');
  return (
    <Panel title={t('onboarding.consentTitle')}>
      <p class="onboarding__text">{t('onboarding.consentBody')}</p>
      <p class="onboarding__text">{t('onboarding.backupNote')}</p>
      <p class="onboarding__note">{t('onboarding.consentNo')}</p>
      <div class="onboarding__actions">
        <Button label={t('onboarding.allow')} variant="primary" {...zone.item(0)} testId="action-0" />
        <Button label={t('onboarding.notNow')} {...zone.item(1)} testId="action-1" />
      </div>
    </Panel>
  );
}

function SourceScreen({ ob, i18n }: ScreenProps) {
  const { t } = i18n;
  const zone = useZone(ob.binding, ob.binding.nav.top, 'types');
  const labels = [t('onboarding.xtream', { name: NAMES.name }), t('onboarding.m3u', { format: NAMES.format })];
  const hints = [t('onboarding.xtreamHint'), t('onboarding.m3uHint')];
  return (
    <Panel title={t('onboarding.sourceTitle')}>
      <p class="onboarding__text">{t('onboarding.sourceBody')}</p>
      <div class="onboarding__types">
        {SOURCE_TYPES.map((type, i) => (
          <Button key={type} label={labels[i] ?? ''} {...zone.item(i)} testId={`type-${type}`} />
        ))}
      </div>
      <p class="onboarding__note" data-testid="type-hint">
        {hints[zone.position.index] ?? ''}
      </p>
    </Panel>
  );
}

function FormScreen({ ob, i18n }: ScreenProps) {
  const { t } = i18n;
  const screen = ob.binding.nav.top;
  const fields = useZone(ob.binding, screen, 'fields');
  const actions = useZone(ob.binding, screen, 'actions');
  const type = ob.type.value;
  const values = ob.values.value;
  const problems = ob.problems.value;
  const title = type === 'xtream' ? t('onboarding.xtream', { name: NAMES.name }) : t('onboarding.m3u', { format: NAMES.format });
  return (
    <Panel title={title}>
      <p class="onboarding__note">{t('onboarding.typeHint')}</p>
      <div class="onboarding__fields">
        {FORM_FIELDS[type].map((field, i) => (
          <TextField
            key={field.id}
            id={fieldDomId(field.id)}
            label={fieldLabel(t, field.id)}
            value={values[field.id] ?? ''}
            kind={field.kind}
            hint={fieldHint(t, field.id)}
            error={problemText(t, problems[field.id])}
            onValue={(value) => ob.setValue(field.id, value)}
            edit={ob.editor.field(fieldDomId(field.id))}
            {...fields.item(i)}
            testId={`field-${field.id}`}
          />
        ))}
      </div>
      <div class="onboarding__actions onboarding__actions--form">
        <Button label={t('onboarding.add')} variant="primary" {...actions.item(0)} testId="action-0" />
      </div>
    </Panel>
  );
}

function LoadingScreen({ ob, i18n }: ScreenProps) {
  const { t } = i18n;
  const zone = useZone(ob.binding, ob.binding.nav.top, 'actions');
  const state = ob.load.value;
  const name = ob.draft.value?.name ?? '';
  if (state.status === 'failed') {
    const message = errorText(t, state.code, state.httpStatus);
    return (
      <Panel title={t('loading.failed', { name })}>
        <p class="onboarding__text onboarding__error" role="alert" data-testid="load-error" data-code={state.code}>
          {message}
        </p>
        <div class="onboarding__actions">
          <Button label={t('loading.edit')} {...zone.item(0)} testId="action-0" />
          <Button label={t('loading.retry')} variant="primary" {...zone.item(1)} testId="action-1" />
        </div>
      </Panel>
    );
  }
  const progress = state.status === 'running' ? state.progress : null;
  const phase = progress?.phase ?? 'checking';
  const status = phaseText(t, phase, progress?.items ?? 0);
  const fraction = progress !== null && progress.total !== null && progress.total > 0 ? progress.bytes / progress.total : null;
  return (
    <Panel title={t('loading.title', { name })}>
      <div class="onboarding__progress">
        <Spinner size="m" label={status} />
        <p class="onboarding__status" data-testid="load-status" data-phase={phase} data-items={progress?.items ?? 0}>
          {status}
        </p>
      </div>
      <ProgressBar value={fraction ?? 0} label={status} class="onboarding__bar" testId="load-progress" />
      <div class="onboarding__actions">
        <Button label={t('action.cancel')} {...zone.item(0)} testId="action-0" />
      </div>
    </Panel>
  );
}

function DoneScreen({ ob, i18n }: ScreenProps) {
  const { t } = i18n;
  // Under the exit dialog too: the done screen is the root then.
  const zone = useZone(ob.binding, ob.root.value, 'actions');
  const state = ob.load.value;
  const result = state.status === 'done' ? state.result : { live: 0, movies: 0, series: 0 };
  return (
    <Panel title={t('done.title')}>
      <p class="onboarding__text">{t('done.body', { name: ob.draft.value?.name ?? '' })}</p>
      <ul class="onboarding__counts">
        <li data-testid="done-live" data-n={result.live}>
          {t('done.live', { n: result.live })}
        </li>
        <li data-testid="done-movies" data-n={result.movies}>
          {t('done.movies', { n: result.movies })}
        </li>
        <li data-testid="done-series" data-n={result.series}>
          {t('done.series', { n: result.series })}
        </li>
      </ul>
      <div class="onboarding__actions">
        <Button label={t('done.start')} variant="primary" {...zone.item(0)} testId="action-0" />
      </div>
    </Panel>
  );
}

function ExitDialog({ ob, i18n }: ScreenProps) {
  const { t } = i18n;
  const zone = useZone(ob.binding, ob.binding.nav.top, 'actions');
  return (
    <Dialog title={t('exit.title')} message={t('exit.message')} testId="exit-dialog">
      <Button label={t('exit.stay')} {...zone.item(0)} testId="dialog-0" />
      <Button label={t('exit.confirm')} {...zone.item(1)} testId="dialog-1" />
    </Dialog>
  );
}

function OnboardingScreen({ ob, i18n, device }: ScreenProps & { device: AppI18n }) {
  const focus = useFocus(ob.binding);
  const editing = ob.editor.editing.value;
  // The exit dialog covers the root: the language screen, or the done screen once the source is in.
  const under = focus.screen === 'exit' ? (ob.load.value.status === 'done' ? 'done' : 'language') : focus.screen;
  return (
    <main
      class="onboarding"
      data-testid="onboarding"
      data-ready="true"
      data-language={i18n.locale.pseudo ? 'pseudo' : i18n.locale.language}
      data-screen={focus.screen}
      data-zone={focus.zone}
      data-index={focus.index}
      data-editing={editing ?? ''}
      data-pointer={String(focus.pointer)}
      data-dir={focus.dir}
    >
      {under === 'language' && <LanguageScreen ob={ob} device={device} />}
      {under === 'disclaimer' && <DisclaimerScreen ob={ob} i18n={i18n} />}
      {under === 'consent' && <ConsentScreen ob={ob} i18n={i18n} />}
      {under === 'source' && <SourceScreen ob={ob} i18n={i18n} />}
      {under === 'form' && <FormScreen ob={ob} i18n={i18n} />}
      {under === 'loading' && <LoadingScreen ob={ob} i18n={i18n} />}
      {under === 'done' && <DoneScreen ob={ob} i18n={i18n} />}
      {focus.screen === 'exit' && <ExitDialog ob={ob} i18n={i18n} />}
    </main>
  );
}

interface Props {
  readonly platform: Platform;
  readonly onboarding: Onboarding;
  /** "Start watching" on the last screen (the live screen takes over from here, step 14a). */
  readonly onFinish?: () => void;
}

/**
 * The first start: waits for the device locale, then shows onboarding in the TV's language.
 * Picking a language on the first screen switches the catalog, `lang`/`dir` on `<html>` and
 * the remote's LEFT/RIGHT live (the gallery's pattern, step 12b), in the TV's region.
 */
export function OnboardingApp({ platform, onboarding, onFinish }: Props) {
  const i18n = useSignal<AppI18n | null>(null);
  const device = useSignal<AppI18n | null>(null);
  useEffect(() => {
    let settings: LocaleSettings | null = null;
    let country: string | null = null;
    const show = (picked: Language | null): void => {
      if (settings === null) return;
      const locale = picked === null || picked === settings.language ? settings : resolveLocale(switchedTag(settings), { country });
      onboarding.nav.setDir(locale.dir);
      document.documentElement.lang = locale.tag;
      document.documentElement.dir = locale.dir;
      i18n.value = appI18n(locale);
    };
    const start = (tag: string, from: string | null): void => {
      country = from;
      settings = resolveLocale(tag, { country });
      device.value = appI18n(settings);
      onboarding.preselect(settings.language);
      show(onboarding.language.peek());
    };
    platform.info().then(
      (info) => start(info.locale, info.country),
      () => start('en-US', null),
    );
    // Runs on each pick, before the next key is handled.
    const stopLanguage = onboarding.language.subscribe(show);
    const stopFinish = onboarding.finished.subscribe((done) => {
      if (done) onFinish?.();
    });
    const disconnect = connectRemote({ platform, nav: onboarding.nav, target: window });
    return () => {
      stopLanguage();
      stopFinish();
      disconnect();
    };
  }, [platform, onboarding, onFinish]);

  if (i18n.value === null || device.value === null) {
    return (
      <main class="onboarding" data-testid="onboarding" data-ready="false">
        <Spinner size="l" />
      </main>
    );
  }
  return <OnboardingScreen ob={onboarding} i18n={i18n.value} device={device.value} />;
}
