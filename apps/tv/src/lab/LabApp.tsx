import type { Intent, Platform } from '@zoma/platform-api';
import type { ItemBinding, ZoneView } from '@zoma/ui';
import { Button, Dialog, TextField, connectRemote, useFocus, useZone } from '@zoma/ui';
import { useEffect } from 'preact/hooks';
import type { KeyTestView, Lab, TextTestView } from './lab-state';
import { ASK_SCREEN, KEYS_SCREEN, TYPE_FIELD, TYPE_SCREEN, outcomeKey } from './lab-state';
import { spikeStatus } from './runner';
import type { KeyPress, LabQuestion, LabStatus, Spike } from './types';

/**
 * The Zoma Lab screen (RELAY step 15a). A developer tool in English only (the
 * `zoma/no-hard-coded-text` lint exempts src/lab, as it does the hello screen): what ran, what
 * passed, and whether the collector has the records.
 */

const STATUS_TEXT: Record<LabStatus, string> = { pass: 'PASS', fail: 'FAIL', info: 'INFO', skip: 'SKIP' };

const records = (n: number): string => `${n} record${n === 1 ? '' : 's'}`;

function StatusTag({ status, testId }: { status: LabStatus | 'running' | null; testId?: string }) {
  const text = status === null ? '—' : status === 'running' ? '…' : STATUS_TEXT[status];
  return (
    <span class={`lab__status lab__status--${status ?? 'none'}`} data-testid={testId} data-status={status ?? 'none'}>
      {text}
    </span>
  );
}

function SpikeRow({ lab, spike, item }: { lab: Lab; spike: Spike; item: ItemBinding }) {
  const outcomes = lab.outcomes.value;
  const done = spike.checks.map((c) => outcomes[outcomeKey(spike.id, c.id)]).filter((o) => o !== undefined);
  const running = lab.current.value?.indexOf(`${spike.id}/`) === 0;
  const status = running ? 'running' : spikeStatus(done.map((o) => o.result.status));
  const cls = `lab__spike${item.state === 'focused' ? ' is-focused' : item.state === 'memory' ? ' is-memory' : ''}`;
  return (
    <li class={cls} data-testid={`spike-${spike.id}`} data-status={status ?? 'none'} onMouseMove={item.onHover} onClick={item.onPress}>
      <span class="lab__spike-id">{spike.id}</span>
      <span class="lab__spike-title">{spike.title}</span>
      <span class="lab__spike-count">
        {done.length}/{spike.checks.length}
      </span>
      <StatusTag status={status} />
    </li>
  );
}

function Checks({ lab, spike }: { lab: Lab; spike: Spike }) {
  const outcomes = lab.outcomes.value;
  return (
    <section class="lab__checks" data-testid="checks" data-spike={spike.id}>
      <h2 class="lab__question">
        {spike.id}: {spike.question}
      </h2>
      <ul class="lab__check-list">
        {spike.checks.map((check) => {
          const key = outcomeKey(spike.id, check.id);
          const outcome = outcomes[key];
          const status = lab.current.value === key ? 'running' : (outcome?.result.status ?? null);
          return (
            <li key={check.id} class="lab__check" data-testid={`check-${spike.id}-${check.id}`} data-status={status ?? 'none'}>
              <StatusTag status={status} />
              <span class="lab__check-text">
                <span class="lab__check-title">{check.title}</span>
                {outcome?.result.note !== undefined && <span class="lab__check-note">{outcome.result.note}</span>}
              </span>
              <span class="lab__check-ms">{outcome === undefined ? '' : `${Math.round(outcome.ms)} ms`}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * A question for the person in front of the TV (S11): one button per label, each with its
 * `aria-label`. In `focus` mode DOM focus follows the remote's focus onto the button (the
 * effect in `LabScreen`); in `live` mode an `aria-live` region says the focused label instead.
 */
function Question({ question, zone, index }: { question: LabQuestion; zone: ZoneView; index: number }) {
  const live = question.mode === 'live';
  return (
    <section class="lab__ask" data-testid="ask" data-mode={question.mode} role="dialog" aria-label={question.title}>
      <div class="lab__ask-panel">
        <h2 class="lab__ask-title">{question.title}</h2>
        <p class="lab__ask-prompt">{question.prompt}</p>
        <div class="lab__ask-items">
          {question.labels.map((label, i) => {
            const item = zone.item(i);
            return (
              <div
                key={label}
                class={`lab__ask-item${item.state === 'focused' ? ' is-focused' : ''}`}
                role="button"
                tabIndex={-1}
                aria-label={label}
                data-testid={`ask-item-${i}`}
                data-state={item.state}
                onMouseMove={item.onHover}
                onClick={item.onPress}
              >
                {label}
              </div>
            );
          })}
        </div>
        {live && (
          <p class="lab__ask-live" aria-live="assertive" data-testid="ask-live">
            {question.labels[index] ?? ''}
          </p>
        )}
      </div>
    </section>
  );
}

/** How the key tester names each Intent: the remote's button. */
const KEY_NAMES: Partial<Record<Intent, string>> = {
  UP: 'Up',
  DOWN: 'Down',
  LEFT: 'Left',
  RIGHT: 'Right',
  CH_UP: 'CH +',
  CH_DOWN: 'CH -',
  PLAY_PAUSE: 'Play/Pause',
  STOP: 'Stop',
  FF: 'Forward',
  RW: 'Rewind',
  INFO: 'Info',
  GUIDE: 'Guide',
  RED: 'Red',
  GREEN: 'Green',
  YELLOW: 'Yellow',
  BLUE: 'Blue',
  PREV_CH: 'PRE-CH',
  AUDIO: 'Audio',
  SUBTITLES: 'Subtitles',
  BACK: 'Back',
};

const keyName = (intent: Intent): string => KEY_NAMES[intent] ?? (intent.indexOf('DIGIT_') === 0 ? intent.slice(6) : intent);

const pressText = (press: KeyPress): string => `${press.keyCode}${press.key === '' ? '' : ` ${press.key}`}`;

/** How many keys with no Intent the tester lists (the latest ones). */
const OTHERS_SHOWN = 10;

/**
 * S10's key tester: a box per Intent, lit with its key code once its key came; the keys the
 * adapter has no Intent for, with their codes; the pointer's counts.
 */
function KeyTester({ view }: { view: KeyTestView }) {
  const first = new Map<Intent, KeyPress>();
  const others: KeyPress[] = [];
  for (const press of view.presses) {
    if (press.intent === null) others.push(press);
    else if (!first.has(press.intent)) first.set(press.intent, press);
  }
  const { pointer } = view;
  return (
    <section class="lab__ask" data-testid="keys" data-seen={first.size} data-presses={view.presses.length} data-backs={view.backs} role="dialog" aria-label={view.test.title}>
      <div class="lab__ask-panel">
        <h2 class="lab__ask-title">{view.test.title}</h2>
        <p class="lab__ask-prompt">{view.test.prompt}</p>
        <ul class="lab__keys">
          {view.test.intents.map((intent) => {
            const press = first.get(intent);
            return (
              <li key={intent} class={`lab__key${press === undefined ? '' : ' is-seen'}`} data-testid={`key-${intent}`} data-seen={press === undefined ? 'false' : 'true'}>
                <span class="lab__key-name">{keyName(intent)}</span>
                <span class="lab__key-code">{press === undefined ? '' : press.keyCode}</span>
              </li>
            );
          })}
        </ul>
        <p class="lab__keys-line" data-testid="keys-other">
          Keys with no action: {others.length === 0 ? 'none yet' : others.slice(-OTHERS_SHOWN).map(pressText).join(', ')}
        </p>
        <p class="lab__keys-line" data-testid="keys-pointer">
          Pointer: shown {pointer.shown}, hidden {pointer.hidden}, moves {pointer.moves}, clicks {pointer.clicks}, wheel {pointer.wheel}
        </p>
        <p class="lab__keys-line" data-testid="keys-back">
          {first.size} of {view.test.intents.length} keys · Back {view.backs} of 2 to finish
        </p>
      </div>
    </section>
  );
}

/** S10's keyboard test: the app's own text field, the keys it saw, the keyboard's events. */
function TypeTest({ view, zone }: { view: TextTestView; zone: ZoneView }) {
  const last = view.edits[view.edits.length - 1];
  return (
    <section class="lab__ask" data-testid="type" data-editing={view.field.editing ? 'true' : 'false'} data-edits={view.edits.length} role="dialog" aria-label={view.test.title}>
      <div class="lab__ask-panel">
        <h2 class="lab__ask-title">{view.test.title}</h2>
        <p class="lab__ask-prompt">{view.test.prompt}</p>
        <TextField id={TYPE_FIELD} label="Type here" value={view.text} hint="OK opens the keyboard" onValue={view.onValue} edit={view.field} {...zone.item(0)} testId="type-field" />
        <p class="lab__keys-line" data-testid="type-keys">
          {last === undefined ? 'No edit yet' : `Edit ${view.edits.length} ended with ${last.how}; its keys: ${last.keys.length === 0 ? 'none' : last.keys.map(pressText).join(', ')}`}
        </p>
        <p class="lab__keys-line" data-testid="type-keyboard">
          Keyboard events: {view.keyboard.length === 0 ? 'none' : view.keyboard.map((shown) => (shown ? 'shown' : 'hidden')).join(', ')}
        </p>
      </div>
    </section>
  );
}

function LabScreen({ lab }: { lab: Lab }) {
  const { binding, home, context, reporter } = lab;
  const focus = useFocus(binding);
  const actions = useZone(binding, home, 'actions');
  const spikes = useZone(binding, home, 'spikes');
  const dialog = focus.screen === 'exit' ? useZone(binding, binding.nav.top, 'buttons') : null;
  const question = lab.question.value;
  const asking = focus.screen === ASK_SCREEN && question !== null ? useZone(binding, binding.nav.top, 'items') : null;
  const keyTest = focus.screen === KEYS_SCREEN ? lab.keyTest.value : null;
  const textTest = focus.screen === TYPE_SCREEN ? lab.textTest.value : null;
  const typing = textTest !== null ? useZone(binding, binding.nav.top, 'field') : null;
  // A question in focus mode: DOM focus follows the remote's, for the TV's screen reader.
  const domFocus = asking !== null && question?.mode === 'focus' ? focus.index : -1;
  useEffect(() => {
    if (domFocus < 0) return;
    const button = document.querySelector(`[data-testid="ask-item-${domFocus}"]`) as HTMLElement | null;
    if (button !== null) button.focus();
  }, [domFocus]);
  const shown = lab.spikes[Math.max(0, home.position('spikes').index)] ?? lab.spikes[0];
  const sent = reporter.state.value;
  const phase = lab.phase.value;

  return (
    <main
      class="lab"
      data-testid="lab"
      data-ready="true"
      data-phase={phase}
      data-runs={lab.runs.value}
      data-session={context.session}
      data-sent={sent.sent}
      data-pending={sent.pending}
      data-screen={focus.screen}
      data-zone={focus.zone}
      data-index={focus.index}
    >
      <header class="lab__header">
        <h1 class="lab__title">Zoma Lab</h1>
        <p class="lab__meta" translate={false}>
          {context.info.platform} · {context.info.model} · lab {context.version}
        </p>
      </header>
      <p class="lab__session" translate={false} data-testid="session">
        Session {context.session} → {context.server}
      </p>
      <p class={`lab__sent${sent.failures > 0 ? ' is-failing' : ''}`} data-testid="sent">
        {sent.failures > 0
          ? `Collector unreachable (${sent.lastError ?? 'no answer'}): ${records(sent.pending)} waiting, retrying`
          : `${records(sent.sent)} sent${sent.pending > 0 ? `, ${sent.pending} waiting` : ''}`}
      </p>

      <div class="lab__actions">
        <Button
          label={phase === 'running' ? 'Running…' : lab.runs.value === 0 ? 'Run all' : 'Run all again'}
          variant="primary"
          {...actions.item(0)}
          testId="run-all"
        />
      </div>

      <div class="lab__body">
        <ul class="lab__spikes" data-testid="spikes">
          {lab.spikes.map((spike, i) => (
            <SpikeRow key={spike.id} lab={lab} spike={spike} item={spikes.item(i)} />
          ))}
        </ul>
        {shown !== undefined && <Checks lab={lab} spike={shown} />}
      </div>

      {asking !== null && question !== null && <Question question={question} zone={asking} index={focus.index} />}
      {keyTest !== null && <KeyTester view={keyTest} />}
      {textTest !== null && typing !== null && <TypeTest view={textTest} zone={typing} />}

      {dialog !== null && (
        <Dialog title="Leave the lab?" message="The records already sent stay in the collector." testId="exit-dialog">
          <Button label="Stay" {...dialog.item(0)} testId="dialog-0" />
          <Button label="Exit" {...dialog.item(1)} testId="dialog-1" />
        </Dialog>
      )}
    </main>
  );
}

export function LabApp({ platform, lab }: { platform: Platform; lab: Lab }) {
  useEffect(() => connectRemote({ platform, nav: lab.nav, target: window }), [platform, lab]);
  return <LabScreen lab={lab} />;
}
