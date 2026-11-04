import type { Platform } from '@zoma/platform-api';
import type { ItemBinding } from '@zoma/ui';
import { Button, Dialog, connectRemote, useFocus, useZone } from '@zoma/ui';
import { useEffect } from 'preact/hooks';
import type { Lab } from './lab-state';
import { outcomeKey } from './lab-state';
import { spikeStatus } from './runner';
import type { LabStatus, Spike } from './types';

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

function LabScreen({ lab }: { lab: Lab }) {
  const { binding, home, context, reporter } = lab;
  const focus = useFocus(binding);
  const actions = useZone(binding, home, 'actions');
  const spikes = useZone(binding, home, 'spikes');
  const dialog = focus.screen === 'exit' ? useZone(binding, binding.nav.top, 'buttons') : null;
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
