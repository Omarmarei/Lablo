import { signal } from '@preact/signals';
import type { ConfigPolicy, LoadedProfile, PolicyRule } from '@lablo/data';
import { emptyProfile, noPolicy } from '@lablo/data';
import type { Intent, KeyLike } from '@lablo/platform-api';
import { describe, expect, it, vi } from 'vitest';
import type { GateView } from './gate-state';
import { createGate, gateView, messageIn, noticesShownOf, refusalFor, stopsApp } from './gate-state';

/** The config gate (RELAY step 30c2a): what shows for a policy, and how it takes the keys. */

const MESSAGE = { en: 'Lablo 1.0.4 fixes playback. Update it from the store.', ar: 'يصلح لابلو 1.0.4 التشغيل. حدّثه من المتجر.' };

function rule(id: string, mode: PolicyRule['mode'], message: PolicyRule['message'] = MESSAGE): PolicyRule {
  return { id, mode, message };
}

function policy(fields: Partial<ConfigPolicy> = {}): ConfigPolicy {
  return { ...noPolicy(), ...fields };
}

describe('gateView', () => {
  it('shows nothing for the defaults, nor for the kill modes the app enforces elsewhere', () => {
    expect(gateView(noPolicy(), [], '1.0.0')).toBeNull();
    expect(gateView(policy({ kill: rule('no-new', 'block-new-sources') }), [], '1.0.0')).toBeNull();
    expect(gateView(policy({ kill: rule('no-play', 'disable-playback') }), [], '1.0.0')).toBeNull();
  });

  it('turns the app off for disable-app, with the doc\'s message or none', () => {
    expect(gateView(policy({ kill: rule('court-order', 'disable-app') }), [], '1.0.0')).toEqual({ kind: 'disabled', id: 'court-order', message: MESSAGE });
    expect(gateView(policy({ kill: rule('court-order', 'disable-app', null) }), [], '1.0.0')).toEqual({ kind: 'disabled', id: 'court-order', message: null });
  });

  it('asks for an update below minVersion, with this version and the one needed', () => {
    expect(gateView(policy({ updateRequired: true, minVersion: '1.2.0' }), [], '1.0.3')).toEqual({ kind: 'update', version: '1.0.3', minVersion: '1.2.0' });
    // (The policy never asks without a minVersion; the view stays readable if it did.)
    expect(gateView(policy({ updateRequired: true, minVersion: null }), [], '1.0.3')).toEqual({ kind: 'update', version: '1.0.3', minVersion: '' });
  });

  it('shows the first notice with a message not shown yet, in the doc\'s order', () => {
    const notices = [rule('silent', 'notice', null), rule('first', 'notice'), rule('second', 'notice', { en: 'Two', ar: 'اثنان' })];
    expect(gateView(policy({ notices }), [], '1.0.0')).toEqual({ kind: 'notice', id: 'first', message: MESSAGE });
    expect(gateView(policy({ notices }), ['first'], '1.0.0')).toEqual({ kind: 'notice', id: 'second', message: { en: 'Two', ar: 'اثنان' } });
    expect(gateView(policy({ notices }), ['second', 'first'], '1.0.0')).toBeNull();
    // A notice without a message never shows, even once the others have.
    expect(gateView(policy({ notices: [rule('silent', 'notice', null)] }), [], '1.0.0')).toBeNull();
  });

  it('puts disable-app before the update, and the update before the notices', () => {
    const notices = [rule('news', 'notice')];
    const kill = rule('off', 'disable-app');
    expect(gateView(policy({ kill, updateRequired: true, minVersion: '2.0.0', notices }), [], '1.0.0')?.kind).toBe('disabled');
    expect(gateView(policy({ kill: rule('no-play', 'disable-playback'), updateRequired: true, minVersion: '2.0.0', notices }), [], '1.0.0')?.kind).toBe('update');
    expect(gateView(policy({ kill: rule('no-play', 'disable-playback'), notices }), [], '1.0.0')?.kind).toBe('notice');
  });
});

describe('refusalFor (RELAY step 30c2b)', () => {
  it('refuses nothing without a kill rule, nor for a notice, nor for an update', () => {
    for (const mode of ['block-new-sources', 'disable-playback'] as const) {
      expect(refusalFor(noPolicy(), mode)).toBeNull();
      expect(refusalFor(policy({ notices: [rule('news', 'notice')], updateRequired: true, minVersion: '9.0.0' }), mode)).toBeNull();
    }
  });

  it('follows the ladder: block-new-sources refuses adds only, disable-playback and disable-app both', () => {
    const add = policy({ kill: rule('no-new', 'block-new-sources') });
    expect(refusalFor(add, 'block-new-sources')).toEqual({ id: 'no-new', message: MESSAGE });
    expect(refusalFor(add, 'disable-playback')).toBeNull();
    const play = policy({ kill: rule('no-play', 'disable-playback', null) });
    expect(refusalFor(play, 'block-new-sources')).toEqual({ id: 'no-play', message: null });
    expect(refusalFor(play, 'disable-playback')).toEqual({ id: 'no-play', message: null });
    const off = policy({ kill: rule('off', 'disable-app') });
    expect(refusalFor(off, 'block-new-sources')).toEqual({ id: 'off', message: MESSAGE });
    expect(refusalFor(off, 'disable-playback')).toEqual({ id: 'off', message: MESSAGE });
  });
});

describe('the helpers', () => {
  it('stops the app under every view but a notice', () => {
    expect(stopsApp(null)).toBe(false);
    expect(stopsApp({ kind: 'notice', id: 'a', message: MESSAGE })).toBe(false);
    expect(stopsApp({ kind: 'disabled', id: 'a', message: null })).toBe(true);
    expect(stopsApp({ kind: 'update', version: '1.0.0', minVersion: '2.0.0' })).toBe(true);
  });

  it('picks the message in the UI\'s language, English for any other', () => {
    expect(messageIn(MESSAGE, 'ar')).toBe(MESSAGE.ar);
    expect(messageIn(MESSAGE, 'en')).toBe(MESSAGE.en);
    expect(messageIn(MESSAGE, 'fr')).toBe(MESSAGE.en);
  });

  it('reads the notices a profile has shown: rule ids only, in order', () => {
    const loaded = (fields: Record<string, unknown>): LoadedProfile => ({ ...({} as LoadedProfile), doc: { ...emptyProfile(), ...fields } as LoadedProfile['doc'] });
    expect(noticesShownOf(null)).toEqual([]);
    expect(noticesShownOf(loaded({}))).toEqual([]);
    expect(noticesShownOf(loaded({ noticesShown: 'first' }))).toEqual([]);
    expect(noticesShownOf(loaded({ noticesShown: ['first', 7, 'Bad Id', '', 'second', null] }))).toEqual(['first', 'second']);
  });
});

interface Listener {
  readonly type: string;
  readonly fn: (event: Event) => void;
  readonly capture: boolean;
  readonly passive: boolean | undefined;
}

/** The window's listeners as added, with their options. */
class FakeTarget {
  readonly listeners: Listener[] = [];
  addEventListener(type: string, fn: (event: Event) => void, options?: AddEventListenerOptions | boolean): void {
    const opts = typeof options === 'object' ? options : { capture: options === true };
    this.listeners.push({ type, fn, capture: opts.capture === true, passive: opts.passive });
  }
  removeEventListener(type: string, fn: (event: Event) => void, options?: EventListenerOptions | boolean): void {
    const capture = typeof options === 'object' ? options.capture === true : options === true;
    const at = this.listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture);
    if (at !== -1) this.listeners.splice(at, 1);
  }
  of(type: string): Listener[] {
    return this.listeners.filter((l) => l.type === type);
  }
  fire(type: string, event: object): void {
    for (const l of this.of(type)) l.fn(event as Event);
  }
}

interface FakeEvent {
  readonly intent: Intent | null;
  readonly stopImmediatePropagation: ReturnType<typeof vi.fn>;
  readonly preventDefault: ReturnType<typeof vi.fn>;
}

function key(intent: Intent | null): FakeEvent {
  return { intent, stopImmediatePropagation: vi.fn(), preventDefault: vi.fn() };
}

function setup(start: ConfigPolicy = noPolicy(), release = true) {
  const config = signal(start);
  const target = new FakeTarget();
  const pointers: ((visible: boolean) => void)[] = [];
  const unsubscribed = vi.fn();
  const platform = {
    keyToIntent: (event: KeyLike) => (event as { readonly intent?: Intent | null }).intent ?? null,
    onPointer: vi.fn((listener: (visible: boolean) => void) => {
      pointers.push(listener);
      return () => {
        unsubscribed();
        const at = pointers.indexOf(listener);
        if (at !== -1) pointers.splice(at, 1);
      };
    }),
    exitApp: vi.fn(),
  };
  const shown = vi.fn();
  const stopped = vi.fn();
  const released = vi.fn();
  const gate = createGate({
    policy: config,
    version: '1.0.0',
    platform,
    target: target as unknown as EventTarget,
    shown,
    stopped,
    ...(release ? { release: released } : {}),
  });
  const press = (intent: Intent | null): FakeEvent => {
    const event = key(intent);
    target.fire('keydown', event);
    return event;
  };
  return { config, target, pointers, unsubscribed, platform, shown, stopped, released, gate, press };
}

const kinds = (view: GateView | null): string | null => (view === null ? null : view.kind);

describe('createGate', () => {
  it('shows nothing and takes no key before it starts', () => {
    const { gate, target, stopped } = setup(policy({ kill: rule('off', 'disable-app') }));
    expect(gate.view.value).toBeNull();
    expect(target.listeners).toEqual([]);
    expect(stopped).not.toHaveBeenCalled();
  });

  it('turns the app off with every key its own, and gives it back when a refresh lifts the rule', () => {
    const { gate, config, target, pointers, unsubscribed, platform, stopped, released, press } = setup(policy({ kill: rule('off', 'disable-app') }));
    gate.start([]);
    expect(kinds(gate.view.value)).toBe('disabled');
    expect(stopped.mock.calls).toEqual([[true]]);
    expect(released).toHaveBeenCalledTimes(1);
    // A capture listener on the window: the app's own (bubbling) remote listener hears nothing.
    expect(target.of('keydown').map((l) => l.capture)).toEqual([true]);
    expect(target.of('wheel').map((l) => [l.capture, l.passive])).toEqual([[true, false]]);
    expect(pointers).toHaveLength(1);
    expect(gate.binding.nav.snapshot()).toMatchObject({ screen: 'disabled', zone: 'buttons', index: 0 });

    // A key the remote maps, and one it doesn't: neither goes further; only the first is the gate's.
    const down = press('DOWN');
    expect(down.stopImmediatePropagation).toHaveBeenCalledTimes(1);
    expect(down.preventDefault).toHaveBeenCalledTimes(1);
    const other = press(null);
    expect(other.stopImmediatePropagation).toHaveBeenCalledTimes(1);
    expect(other.preventDefault).not.toHaveBeenCalled();
    const wheel = key(null);
    target.fire('wheel', wheel);
    expect(wheel.stopImmediatePropagation).toHaveBeenCalledTimes(1);
    expect(wheel.preventDefault).toHaveBeenCalledTimes(1);
    expect(gate.binding.nav.snapshot()).toMatchObject({ screen: 'disabled', index: 0 });
    expect(platform.exitApp).not.toHaveBeenCalled();

    // OK on "Close Lablo", and Back, leave the app; the view stays (the browser can't close its tab).
    press('OK');
    expect(platform.exitApp).toHaveBeenCalledTimes(1);
    expect(gate.exitRequested.value).toBe(true);
    press('BACK');
    expect(platform.exitApp).toHaveBeenCalledTimes(2);
    expect(kinds(gate.view.value)).toBe('disabled');

    // The pointer works on the gate's own button: the system's events, and a move on the page.
    pointers[0]!(true);
    expect(gate.binding.nav.snapshot().pointer).toBe(true);
    pointers[0]!(false);
    expect(gate.binding.nav.snapshot().pointer).toBe(false);
    target.fire('mousemove', { screenX: 10, screenY: 20 });
    expect(gate.binding.nav.snapshot().pointer).toBe(true);

    // The next refresh lifts it: the keys and the app go back.
    config.value = noPolicy();
    expect(gate.view.value).toBeNull();
    expect(stopped.mock.calls).toEqual([[true], [false]]);
    expect(target.listeners).toEqual([]);
    expect(pointers).toHaveLength(0);
    expect(unsubscribed).toHaveBeenCalledTimes(1);
    expect(gate.binding.nav.snapshot().screen).toBe('none');
    // Disposed with nothing on show: nothing more to take back.
    gate.dispose();
    expect(unsubscribed).toHaveBeenCalledTimes(1);
  });

  it('asks for an update the same way, and moves between the two without a second stop', () => {
    const { gate, config, target, stopped, released, press, platform } = setup(policy({ updateRequired: true, minVersion: '2.0.0' }));
    gate.start([]);
    expect(gate.view.value).toEqual({ kind: 'update', version: '1.0.0', minVersion: '2.0.0' });
    expect(gate.binding.nav.snapshot().screen).toBe('update');
    press('BACK');
    expect(platform.exitApp).toHaveBeenCalledTimes(1);
    config.value = policy({ kill: rule('off', 'disable-app'), updateRequired: true, minVersion: '2.0.0' });
    expect(kinds(gate.view.value)).toBe('disabled');
    expect(gate.binding.nav.snapshot().screen).toBe('disabled');
    expect(stopped.mock.calls).toEqual([[true]]);
    expect(released).toHaveBeenCalledTimes(1);
    expect(target.of('keydown')).toHaveLength(1);
  });

  it('shows each notice once, keeps its id, and never stops the app', () => {
    const notices = [rule('first', 'notice'), rule('second', 'notice', { en: 'Two', ar: 'اثنان' })];
    const { gate, target, shown, stopped, press, platform } = setup(policy({ notices }));
    gate.start([]);
    expect(gate.view.value).toEqual({ kind: 'notice', id: 'first', message: MESSAGE });
    expect(target.of('keydown')).toHaveLength(1);
    // Keys don't move anything; OK closes the first, and the second follows on the same screen.
    press('RIGHT');
    press('OK');
    expect(shown.mock.calls).toEqual([['first']]);
    expect(gate.view.value).toEqual({ kind: 'notice', id: 'second', message: { en: 'Two', ar: 'اثنان' } });
    expect(gate.binding.nav.snapshot()).toMatchObject({ screen: 'notice', index: 0 });
    // Back closes it too.
    press('BACK');
    expect(shown.mock.calls).toEqual([['first'], ['second']]);
    expect(gate.view.value).toBeNull();
    expect(target.listeners).toEqual([]);
    expect(stopped).not.toHaveBeenCalled();
    expect(platform.exitApp).not.toHaveBeenCalled();
    expect(gate.exitRequested.value).toBe(false);
  });

  it('skips the notices the profile has shown, and takes only the first start', () => {
    const notices = [rule('first', 'notice'), rule('second', 'notice')];
    const { gate } = setup(policy({ notices }));
    gate.start(['first']);
    expect(gate.view.value).toMatchObject({ kind: 'notice', id: 'second' });
    gate.start([]);
    expect(gate.view.value).toMatchObject({ kind: 'notice', id: 'second' });
  });

  it('puts a notice off while the app is off, and shows it once the rule lifts', () => {
    const { gate, config, stopped } = setup(policy({ kill: rule('off', 'disable-app'), notices: [rule('news', 'notice')] }));
    gate.start([]);
    expect(kinds(gate.view.value)).toBe('disabled');
    config.value = policy({ notices: [rule('news', 'notice')] });
    expect(gate.view.value).toMatchObject({ kind: 'notice', id: 'news' });
    expect(gate.binding.nav.snapshot().screen).toBe('notice');
    expect(stopped.mock.calls).toEqual([[true], [false]]);
  });

  it('gives the keys back when disposed, and follows the policy no more', () => {
    const { gate, config, target, stopped } = setup(policy({ kill: rule('off', 'disable-app') }));
    gate.start([]);
    gate.dispose();
    expect(target.listeners).toEqual([]);
    // Its focus follows the navigator no more either.
    gate.binding.nav.push({ id: 'later', zones: [{ kind: 'list', id: 'x', axis: 'horizontal', count: 1 }] });
    expect(gate.binding.focus.value.screen).toBe('disabled');
    config.value = policy({ notices: [rule('news', 'notice')] });
    config.value = policy({ kill: rule('off', 'disable-app') });
    // Through nothing on show and back: still nothing connected, no stop or restart.
    config.value = noPolicy();
    config.value = policy({ kill: rule('off', 'disable-app') });
    expect(target.listeners).toEqual([]);
    expect(stopped.mock.calls).toEqual([[true]]);
  });

  it('blurs the page\'s focused element by default (a text field being edited ends its edit)', () => {
    // No document in Node: nothing to do.
    const bare = setup(policy({ kill: rule('off', 'disable-app') }), false);
    expect(() => bare.gate.start([])).not.toThrow();
    expect(kinds(bare.gate.view.value)).toBe('disabled');
    const blur = vi.fn();
    vi.stubGlobal('document', { activeElement: { blur } });
    try {
      const { gate, config } = setup(policy({ notices: [rule('news', 'notice')] }), false);
      gate.start([]);
      expect(blur).toHaveBeenCalledTimes(1);
      // Only when the gate opens: not again for the next view.
      config.value = policy({ kill: rule('off', 'disable-app') });
      expect(blur).toHaveBeenCalledTimes(1);
      // No focused element, or one without `blur`: nothing to blur.
      vi.stubGlobal('document', { activeElement: null });
      const other = setup(policy({ kill: rule('off', 'disable-app') }), false);
      expect(() => other.gate.start([])).not.toThrow();
      vi.stubGlobal('document', { activeElement: {} });
      const plain = setup(policy({ kill: rule('off', 'disable-app') }), false);
      expect(() => plain.gate.start([])).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
