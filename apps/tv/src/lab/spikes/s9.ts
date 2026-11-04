/**
 * S9 from docs/architecture.md §5: does Arabic text render right? The app bundles its fonts
 * (Zoma Sans: Noto Sans and Noto Sans Arabic UI subsets), isolates text arguments itself
 * (core's `isolateText`) and formats dates and numbers without `Intl` (ADR-011), so S9 mostly
 * confirms those choices on the TV:
 * - `fonts`: the four Zoma Sans faces load from the package;
 * - `shaping`: Arabic letters join and lam-alef ligates in them (the subsets kept their shaping);
 * - `bidi`: the isolation keeps a Latin name with its digits in an Arabic line, and draws nothing
 *   (Chromium 53/56/68 ignore FSI/PDI: the marks around them do the work there);
 * - `intl`: what the engine's `Intl` makes of Arabic (the calendar, the digits), beside the
 *   app's own output. A measurement: the app doesn't use it.
 */
import { isolateText } from '@zoma/core';
import type { Check, CheckResult, Spike } from '../types';
import { ARABIC_WORD, FONT_FAMILY, SHAPING_WORD, bidiFailures, fontFailures, fontSet, intlNote, loadFaces, measureBidi, measureBox, measureShaping, readIntl, shapingVerdict } from '../arabic';

const ltr = (text: string): string => isolateText(text, 'ltr');

const fonts: Check = {
  id: 'fonts',
  title: 'The Zoma Sans faces load (Latin and Arabic, 400 and 700)',
  run: async (): Promise<CheckResult> => {
    const set = fontSet();
    if (set === null) return { status: 'info', note: 'no CSS Font Loading API (document.fonts): the faces cannot be read here' };
    const faces = await loadFaces(set);
    const failures = fontFailures(faces);
    const value = { faces: faces.map((f) => `${f.face}:${f.status}`) };
    return failures.length === 0 ? { status: 'pass', value, note: 'all four faces loaded' } : { status: 'fail', value, note: failures.join('; ') };
  },
};

const shaping: Check = {
  id: 'shaping',
  title: 'Arabic letters join and lam-alef ligates in Zoma Sans',
  run: (): Promise<CheckResult> => {
    const set = fontSet();
    // Measured in a fallback font, the test would say nothing about ours.
    const loaded = set === null ? null : set.check(`48px "${FONT_FAMILY}"`, SHAPING_WORD);
    const measure = measureBox();
    try {
      const answer = measureShaping(measure.width);
      return Promise.resolve({ ...shapingVerdict(answer, loaded), value: { ...answer, arabicFaceLoaded: loaded } });
    } finally {
      measure.done();
    }
  },
};

const bidi: Check = {
  id: 'bidi',
  title: 'Latin names with digits keep their order in an Arabic line',
  run: (): Promise<CheckResult> => {
    const measure = measureBox();
    try {
      const answer = measureBidi(measure.box, measure.width);
      const failures = bidiFailures(answer);
      return Promise.resolve(
        failures.length === 0
          ? { status: 'pass', value: answer, note: `${ltr(`MBC 1 · 240 ${ARABIC_WORD}`)} and ${ltr(`1 Zoma ${ARABIC_WORD}`)} held together; the isolation is not drawn` }
          : { status: 'fail', value: answer, note: failures.join('; ') },
      );
    } finally {
      measure.done();
    }
  },
};

const intl: Check = {
  id: 'intl',
  title: "What Intl makes of Arabic (calendar, digits), beside the app's formatters",
  run: () => {
    const answer = readIntl(typeof Intl === 'object' ? Intl : undefined);
    return Promise.resolve<CheckResult>({ status: 'info', value: answer, note: intlNote(answer) });
  },
};

export const S9: Spike = {
  id: 'S9',
  title: 'Arabic',
  question: 'Does Arabic render right: the bundled fonts shaped, mixed names in order, and Intl with ar?',
  checks: [fonts, shaping, bidi, intl],
};
