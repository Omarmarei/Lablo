import type { FocusDemo } from './focus-demo';
import { GRID_ITEMS, LIST_ITEMS, LIST_VISIBLE, RAIL_ITEMS } from './focus-demo';

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i += 1) out.push(i);
  return out;
}

interface DialogProps {
  readonly demo: FocusDemo;
  readonly testId: string;
  readonly title: string;
  readonly buttons: readonly [string, string];
}

/** A pushed screen's two buttons; the focus engine's `buttons` zone. */
function Dialog({ demo, testId, title, buttons }: DialogProps) {
  const focus = demo.focus.value;
  return (
    <div class="focus__dialog" data-testid={testId}>
      <p>{title}</p>
      <div class="focus__buttons">
        {buttons.map((label, i) => (
          <div
            key={label}
            class={`focus__button${focus.index === i ? ' is-focused' : ''}`}
            data-testid={`${testId}-${i}`}
            onMouseMove={() => demo.nav.top.hover('buttons', i)}
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The focus engine on the hello screen (relay step 10). Focus is an index in the engine,
 * not DOM focus: each item only reads whether it is the focused one. The thick outline is
 * the focus; a thin one is another zone's remembered item. `dir="rtl"` mirrors the flex rows,
 * and the engine swaps LEFT and RIGHT to match.
 */
export function FocusPanel({ demo }: { readonly demo: FocusDemo }) {
  const focus = demo.focus.value;
  const home = demo.home;
  const onHome = focus.screen === 'home';
  const item = (zone: string, index: number): string => {
    if (home.position(zone).index !== index) return 'focus__item';
    return home.active === zone ? 'focus__item is-focused' : 'focus__item is-memory';
  };
  const top = home.position('list').top;
  const opened = demo.opened.value[focus.depth - 2] ?? '';

  return (
    <div class={`focus${onHome ? '' : ' is-covered'}`} dir={focus.dir} data-testid="focus-panel">
      <p class="focus__status">
        Focus:{' '}
        <span
          data-testid="focus-status"
          data-screen={focus.screen}
          data-zone={focus.zone}
          data-index={focus.index}
          data-depth={focus.depth}
          data-pointer={String(focus.pointer)}
          data-dir={focus.dir}
        >
          {`${focus.screen} · ${focus.zone} ${focus.index}`}
        </span>
      </p>
      <div class="focus__rail">
        {range(0, RAIL_ITEMS).map((i) => (
          <div key={i} class={item('rail', i)} data-testid={`rail-${i}`} onMouseMove={() => home.hover('rail', i)}>
            {`R${i + 1}`}
          </div>
        ))}
      </div>
      <div class="focus__body">
        <div class="focus__list">
          {range(top, Math.min(top + LIST_VISIBLE, LIST_ITEMS)).map((i) => (
            <div key={i} class={item('list', i)} data-testid={`list-${i}`} onMouseMove={() => home.hover('list', i)}>
              {`Item ${i + 1}`}
            </div>
          ))}
        </div>
        <div class="focus__grid">
          {range(0, GRID_ITEMS).map((i) => (
            <div key={i} class={item('grid', i)} data-testid={`grid-${i}`} onMouseMove={() => home.hover('grid', i)}>
              {`G${i + 1}`}
            </div>
          ))}
        </div>
      </div>
      {focus.screen === 'details' && (
        <Dialog demo={demo} testId="details" title={`Opened ${opened}`} buttons={['Close', 'More']} />
      )}
      {focus.screen === 'exit' && <Dialog demo={demo} testId="exit-dialog" title="Exit Lablo?" buttons={['Stay', 'Exit']} />}
    </div>
  );
}
