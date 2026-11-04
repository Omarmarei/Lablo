/**
 * S11 from docs/architecture.md §5: lifecycle and accessibility. Can the app keep the
 * screensaver away, and does the TV's screen reader (Samsung Voice Guide, LG Audio Guidance)
 * read what has the focus? The app's focus is the focus engine's, not the DOM's, so S11 asks
 * a person two questions by ear: with DOM focus following the remote (`aria-label` on each
 * button), and with an `aria-live` region announcing the focused label. If neither is read, the
 * plan's fallback is speech through the adapter on each focus change (`Platform.speak`).
 *
 * The questions run only when a person starts S11 from its row (`LabContext.interactive`); in
 * "Run all" and at launch they skip, since nobody may be watching.
 */
import type { PlatformCall, ScreenReaderState } from '@zoma/platform-api';
import { lifecycleNote } from '../lifecycle';
import type { Check, CheckResult, LabAnswer, LabContext, LabQuestion, Spike } from '../types';

/** What the speech check asks the TV to say. */
export const SPOKEN = 'Zoma Lab, spike S11';
/** How long a question waits for its answer. */
export const ASK_TIMEOUT_MS = 5 * 60_000;

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const lifecycle: Check = {
  id: 'lifecycle',
  title: 'Lifecycle log: hidden, visible and relaunch while the lab is open',
  run: (context: LabContext) => {
    const entries = context.lifecycle.entries;
    const visibility = typeof document !== 'undefined' && typeof document.visibilityState === 'string' ? document.visibilityState : null;
    return Promise.resolve<CheckResult>({ status: 'info', value: { entries: entries.slice(), visibility }, note: lifecycleNote(entries) });
  },
};

const screensaver: Check = {
  id: 'screensaver',
  title: 'The app can keep the screensaver away',
  run: async (context: LabContext): Promise<CheckResult> => {
    let answer: PlatformCall;
    try {
      answer = await context.platform.setScreenSaver(false);
    } catch (error) {
      return { status: 'fail', note: errorText(error) };
    }
    const value = { answer };
    if (answer === 'done') return { status: 'pass', value, note: 'off while the lab is open: leave the TV idle past its screensaver time, and none should come' };
    if (context.info.platform === 'browser') return { status: 'skip', value, note: 'a desktop browser has no screensaver' };
    if (context.info.platform === 'webos') return { status: 'info', value, note: "webOS has no screensaver API for apps: full-screen video keeps it away (LG's guide)" };
    return { status: 'fail', value, note: 'webapis.appcommon.setScreenSaver is missing' };
  },
};

const screenReader: Check = {
  id: 'screen-reader',
  title: 'Is the screen reader on (Voice Guide, Audio Guidance)?',
  run: async (context: LabContext): Promise<CheckResult> => {
    const state = await context.platform.screenReader();
    if (context.info.platform === 'browser') return { status: 'skip', value: state, note: state.detail };
    return { status: 'info', value: state, note: state.on === null ? `unknown: ${state.detail}` : state.on ? 'on' : 'off' };
  },
};

const speech: Check = {
  id: 'speech',
  title: "The TV's own speech takes a sentence",
  run: async (context: LabContext): Promise<CheckResult> => {
    let answer: PlatformCall;
    try {
      answer = await context.platform.speak(SPOKEN);
    } catch (error) {
      return { status: 'fail', note: errorText(error) };
    }
    const value = { answer };
    if (answer === 'done') return { status: 'pass', value, note: `taken: the TV should have said "${SPOKEN}"` };
    if (context.info.platform === 'browser') return { status: 'skip', value, note: 'a desktop browser has no TV speech' };
    if (context.info.platform === 'tizen') return { status: 'info', value, note: 'Tizen has no speech API for web apps: Voice Guide reads aria-live regions (live-reading)' };
    return { status: 'info', value, note: 'no luna bridge here (only on a webOS TV)' };
  },
};

/** The answer as a result: GREEN pass, RED fail, BACK or no answer skip. */
export function answerResult(answer: LabAnswer, reader: ScreenReaderState | null): CheckResult {
  const value = { ...answer, screenReader: reader };
  const moves = `${answer.moves} move${answer.moves === 1 ? '' : 's'}`;
  switch (answer.answer) {
    case 'yes':
      return { status: 'pass', value, note: `read (answered after ${moves})` };
    case 'no':
      return { status: 'fail', value, note: `not read (answered after ${moves})` };
    case 'skip':
      return { status: 'skip', value, note: 'skipped with Back' };
    default:
      return { status: 'skip', value, note: `nobody answered within ${ASK_TIMEOUT_MS / 60_000} minutes` };
  }
}

const LABELS = ['Zoma Lab first button', 'Zoma Lab second button', 'Zoma Lab third button'];
const KEYS = 'GREEN: each name was read. RED: not read. BACK: skip.';

function reading(id: string, title: string, question: Omit<LabQuestion, 'labels' | 'timeoutMs'>): Check {
  return {
    id,
    title,
    timeoutMs: ASK_TIMEOUT_MS + 10_000,
    run: async (context: LabContext): Promise<CheckResult> => {
      if (!context.interactive) return { status: 'skip', note: 'run S11 alone (OK on its row) and answer by ear' };
      const reader = await context.platform.screenReader().catch(() => null);
      const answer = await context.ask({ ...question, labels: LABELS, timeoutMs: ASK_TIMEOUT_MS });
      return answerResult(answer, reader);
    },
  };
}

const focusReading = reading('focus-reading', 'The screen reader reads the focused button (DOM focus, aria-label)', {
  title: 'Does the TV read each button as the focus moves?',
  prompt: `Turn on Voice Guide (Samsung) or Audio Guidance (LG), then move left and right. ${KEYS}`,
  mode: 'focus',
});

const liveReading = reading('live-reading', 'The screen reader reads an announcement of the focused button (aria-live)', {
  title: 'Does the TV announce each button as the focus moves?',
  prompt: `Same again: these buttons never take DOM focus, an announcement says their name. ${KEYS}`,
  mode: 'live',
});

export const S11: Spike = {
  id: 'S11',
  title: 'Lifecycle, a11y',
  question: 'Lifecycle and accessibility: the screensaver kept away, the screen reader reading the focus?',
  checks: [lifecycle, screensaver, screenReader, speech, focusReading, liveReading],
};
