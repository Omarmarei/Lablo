import type { LoadedProfile, ProfileEdit } from '@lablo/data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TelemetrySwitchEngine } from './telemetry-switch';
import { createTelemetrySwitch } from './telemetry-switch';

// RELAY step 33b3: Settings' "Usage and crash reports" row, switched in place by OK.

interface Held<T> {
  resolve(value: T): void;
  reject(error: unknown): void;
}

function held<T>(into: Held<T>[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    into.push({ resolve, reject });
  });
}

/** A stored profile: off when it says `telemetry: false`. */
function stored(on: boolean): LoadedProfile {
  const doc: Record<string, unknown> = { v: 1, sources: [] };
  if (!on) doc['telemetry'] = false;
  return { doc, newer: false, migratedFrom: null } as unknown as LoadedProfile;
}

/** A data engine and main's telemetry whose answers are held until the test gives them, all calls in one log. */
class Fakes implements TelemetrySwitchEngine {
  readonly log: string[] = [];
  readonly profiles: Held<LoadedProfile | null>[] = [];
  readonly edits: Held<boolean>[] = [];
  readonly sets: Held<void>[] = [];
  profile(): Promise<LoadedProfile | null> {
    this.log.push('profile');
    return held(this.profiles);
  }
  editProfile(edit: ProfileEdit): Promise<boolean> {
    this.log.push(`edit ${edit.kind} ${String((edit as { on?: boolean }).on)}`);
    return held(this.edits);
  }
  readonly setOn = (on: boolean): Promise<void> => {
    this.log.push(`setOn ${String(on)}`);
    return held(this.sets);
  };
  lastProfile(): Held<LoadedProfile | null> {
    return this.profiles[this.profiles.length - 1]!;
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function setup() {
  const fakes = new Fakes();
  const row = createTelemetrySwitch({ engine: fakes, setOn: fakes.setOn });
  return { fakes, row };
}

/** A row read as `on`. */
async function readAs(on: boolean) {
  const t = setup();
  t.row.read();
  t.fakes.lastProfile().resolve(stored(on));
  await flush();
  t.fakes.log.length = 0;
  return t;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the usage reports’ switch (RELAY step 33b3)', () => {
  it('reads the stored switch at each opening: no value until it answers, on unless the profile says false', async () => {
    const t = setup();
    expect(t.row.value.value).toBeNull();
    t.row.read();
    expect(t.fakes.log).toEqual(['profile']);
    expect(t.row.pending.value).toBe(1);
    expect(t.row.value.value).toBeNull();
    t.fakes.lastProfile().resolve(stored(true));
    await flush();
    expect(t.row.value.value).toBe(true);
    expect(t.row.pending.value).toBe(0);
    t.row.read();
    t.fakes.lastProfile().resolve(stored(false));
    await flush();
    expect(t.row.value.value).toBe(false);
    // No profile yet reads as on, as main's start does.
    t.row.read();
    t.fakes.lastProfile().resolve(null);
    await flush();
    expect(t.row.value.value).toBe(true);
    expect(t.row.busy.value).toBe(false);
    expect(t.row.failed.value).toBe(false);
  });

  it('logs a read that fails and shows no value; an older read’s answer is dropped', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = await readAs(true);
    t.row.read();
    t.fakes.lastProfile().reject(new Error('gone'));
    await flush();
    expect(t.row.value.value).toBeNull();
    expect(t.row.pending.value).toBe(0);
    expect(warn).toHaveBeenCalledWith("The usage reports' switch could not be read", expect.any(Error));
    expect(t.row.failed.value).toBe(false);

    // Two reads: the first answers last, and is dropped either way.
    t.row.read();
    t.row.read();
    t.fakes.profiles[t.fakes.profiles.length - 1]!.resolve(stored(false));
    await flush();
    t.fakes.profiles[t.fakes.profiles.length - 2]!.resolve(stored(true));
    await flush();
    expect(t.row.value.value).toBe(false);
    t.row.read();
    t.row.read();
    t.fakes.profiles[t.fakes.profiles.length - 1]!.resolve(stored(true));
    await flush();
    t.fakes.profiles[t.fakes.profiles.length - 2]!.reject(new Error('late'));
    await flush();
    expect(t.row.value.value).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('switches on OK: the edit first, the profile read back, then main told what it stored; busy until main has cleared', async () => {
    const t = await readAs(true);
    t.row.press();
    expect(t.row.busy.value).toBe(true);
    expect(t.row.pending.value).toBe(1);
    expect(t.fakes.log).toEqual(['edit telemetry false']);
    t.fakes.edits[0]!.resolve(true);
    await flush();
    expect(t.fakes.log).toEqual(['edit telemetry false', 'profile']);
    // Still "On" until the stored switch is read back.
    expect(t.row.value.value).toBe(true);
    t.fakes.lastProfile().resolve(stored(false));
    await flush();
    expect(t.fakes.log).toEqual(['edit telemetry false', 'profile', 'setOn false']);
    expect(t.row.value.value).toBe(false);
    expect(t.row.failed.value).toBe(false);
    // Main's clearing send is still out: busy, counted.
    expect(t.row.busy.value).toBe(true);
    expect(t.row.pending.value).toBe(1);
    t.fakes.sets[0]!.resolve();
    await flush();
    expect(t.row.busy.value).toBe(false);
    expect(t.row.pending.value).toBe(0);

    // And on again.
    t.fakes.log.length = 0;
    t.row.press();
    t.fakes.edits[1]!.resolve(true);
    await flush();
    t.fakes.lastProfile().resolve(stored(true));
    await flush();
    t.fakes.sets[1]!.resolve();
    await flush();
    expect(t.fakes.log).toEqual(['edit telemetry true', 'profile', 'setOn true']);
    expect(t.row.value.value).toBe(true);
    expect(t.row.busy.value).toBe(false);
  });

  it('does nothing on OK while a change runs, and a read meanwhile is left to the change', async () => {
    const t = await readAs(true);
    t.row.press();
    t.row.press();
    t.row.read();
    expect(t.fakes.log).toEqual(['edit telemetry false']);
    t.fakes.edits[0]!.resolve(true);
    await flush();
    t.fakes.lastProfile().resolve(stored(false));
    await flush();
    t.row.press();
    t.row.read();
    expect(t.fakes.log).toEqual(['edit telemetry false', 'profile', 'setOn false']);
    t.fakes.sets[0]!.resolve();
    await flush();
    t.row.press();
    expect(t.fakes.log[t.fakes.log.length - 1]).toBe('edit telemetry true');
  });

  it('says a change didn’t take when the stored switch isn’t what was asked, and follows the stored one', async () => {
    const t = await readAs(true);
    t.row.press();
    // A newer app's profile: the edit changes nothing.
    t.fakes.edits[0]!.resolve(false);
    await flush();
    t.fakes.lastProfile().resolve(stored(true));
    await flush();
    expect(t.fakes.log).toEqual(['edit telemetry false', 'profile', 'setOn true']);
    expect(t.row.value.value).toBe(true);
    expect(t.row.failed.value).toBe(true);
    t.fakes.sets[0]!.resolve();
    await flush();
    expect(t.row.busy.value).toBe(false);
    expect(t.row.failed.value).toBe(true);
    // The next OK clears it, and so does an opening.
    t.row.press();
    expect(t.row.failed.value).toBe(false);
    t.fakes.edits[1]!.resolve(true);
    await flush();
    t.fakes.lastProfile().resolve(stored(true));
    await flush();
    t.fakes.sets[1]!.resolve();
    await flush();
    expect(t.row.failed.value).toBe(true);
    t.row.read();
    expect(t.row.failed.value).toBe(false);
  });

  it('says so when the edit or its read-back fails, changes nothing and tells main nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = await readAs(true);
    t.row.press();
    t.fakes.edits[0]!.reject(new Error('quota'));
    await flush();
    expect(t.fakes.log).toEqual(['edit telemetry false']);
    expect(t.row.value.value).toBe(true);
    expect(t.row.failed.value).toBe(true);
    expect(t.row.busy.value).toBe(false);
    expect(t.row.pending.value).toBe(0);
    expect(warn).toHaveBeenCalledWith("The usage reports' switch could not be changed", expect.any(Error));

    t.row.press();
    t.fakes.edits[1]!.resolve(true);
    await flush();
    t.fakes.lastProfile().reject(new Error('gone'));
    await flush();
    expect(t.fakes.log).toEqual(['edit telemetry false', 'edit telemetry false', 'profile']);
    expect(t.row.value.value).toBe(true);
    expect(t.row.failed.value).toBe(true);
    expect(t.row.busy.value).toBe(false);

    // An engine that throws at once is a failed change too.
    const engine: TelemetrySwitchEngine = {
      profile: () => Promise.resolve(stored(true)),
      editProfile: () => {
        throw new Error('closed');
      },
    };
    const setOn = vi.fn(() => Promise.resolve());
    const row = createTelemetrySwitch({ engine, setOn });
    row.read();
    await flush();
    row.press();
    await flush();
    expect(row.failed.value).toBe(true);
    expect(row.busy.value).toBe(false);
    expect(row.pending.value).toBe(0);
    expect(setOn).not.toHaveBeenCalled();
  });

  it('reads again on OK while it has no value', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = setup();
    t.row.press();
    expect(t.fakes.log).toEqual(['profile']);
    expect(t.row.busy.value).toBe(false);
    t.fakes.lastProfile().reject(new Error('gone'));
    await flush();
    t.row.press();
    t.fakes.lastProfile().resolve(stored(false));
    await flush();
    expect(t.fakes.log).toEqual(['profile', 'profile']);
    expect(t.row.value.value).toBe(false);
    expect(t.row.failed.value).toBe(false);
  });

  it('drops an opening’s read still out when OK changes the switch', async () => {
    const t = await readAs(true);
    t.row.read();
    const opening = t.fakes.lastProfile();
    t.row.press();
    t.fakes.edits[0]!.resolve(true);
    await flush();
    t.fakes.lastProfile().resolve(stored(false));
    await flush();
    opening.resolve(stored(true));
    await flush();
    expect(t.row.value.value).toBe(false);
  });

  it('once disposed: starts nothing, shows nothing new, and still tells main what was stored', async () => {
    const t = await readAs(true);
    t.row.press();
    t.row.dispose();
    t.fakes.edits[0]!.resolve(true);
    await flush();
    t.fakes.lastProfile().resolve(stored(false));
    await flush();
    expect(t.fakes.log).toEqual(['edit telemetry false', 'profile', 'setOn false']);
    expect(t.row.value.value).toBe(true);
    expect(t.row.failed.value).toBe(false);
    t.fakes.sets[0]!.resolve();
    await flush();
    t.row.read();
    t.row.press();
    expect(t.fakes.log).toHaveLength(3);

    // A read out when disposed, and a failed change, change nothing.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const u = await readAs(true);
    u.row.read();
    u.row.dispose();
    u.fakes.lastProfile().resolve(stored(false));
    await flush();
    expect(u.row.value.value).toBe(true);
    const v = await readAs(true);
    v.row.read();
    v.row.dispose();
    v.fakes.lastProfile().reject(new Error('gone'));
    await flush();
    expect(v.row.value.value).toBe(true);
    const w = await readAs(true);
    w.row.press();
    w.row.dispose();
    w.fakes.edits[0]!.reject(new Error('gone'));
    await flush();
    expect(w.row.failed.value).toBe(false);
    expect(w.row.busy.value).toBe(false);
  });
});
