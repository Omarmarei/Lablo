/**
 * Expressions `pnpm tv` evaluates in the TV page. They run on the TV's own engine (Chromium 69 on
 * the 2020 Samsung, 53 on the oldest webOS), so they are written in ES5 and return plain data.
 */

/** Characters of the page's text `pnpm tv screen` returns. */
export const SCREEN_TEXT_LIMIT = 2000;

/**
 * What is on screen without a screenshot: the focus engine's path (`window.__LABLO_TEST__`, in
 * every build) and the page's visible text.
 */
export const SCREEN_EXPRESSION = `(function () {
  var hook = window.__LABLO_TEST__;
  var text = document.body ? document.body.innerText : '';
  return {
    focus: hook ? hook.focusPath() : null,
    text: text.length > ${SCREEN_TEXT_LIMIT} ? text.slice(0, ${SCREEN_TEXT_LIMIT}) + ' [...]' : text
  };
})()`;

/** `MARKS_EXPRESSION`'s answer as aligned lines (`lablo:resume       4813 ms`), or the raw value if it isn't one. */
export function formatMarks(value: unknown): string {
  const { domContentLoaded, marks } = (value ?? {}) as { domContentLoaded?: unknown; marks?: unknown };
  if (!Array.isArray(marks)) return JSON.stringify(value);
  const rows: [string, string][] = [['DOMContentLoaded', typeof domContentLoaded === 'number' ? `${domContentLoaded} ms` : '-']];
  for (const mark of marks as unknown[]) {
    if (Array.isArray(mark)) rows.push([String(mark[0]), `${String(mark[1])} ms`]);
  }
  const width = Math.max(...rows.map(([name]) => name.length));
  return rows.map(([name, ms]) => `${name.padEnd(width)}  ${ms.padStart(8)}`).join('\n');
}

/**
 * The start's User Timing marks (`lablo:resume`, `lablo:live-ready`, `lablo:resume-frame`) in ms
 * from the page's navigation start, and `DOMContentLoaded` on the same clock (RELAY step 39s4).
 */
export const MARKS_EXPRESSION = `(function () {
  var t = performance.timing;
  var marks = performance.getEntriesByType('mark').filter(function (m) { return m.name.indexOf('lablo:') === 0; });
  return {
    domContentLoaded: t.domContentLoadedEventStart > 0 ? t.domContentLoadedEventStart - t.navigationStart : null,
    marks: marks.map(function (m) { return [m.name, Math.round(m.startTime)]; })
  };
})()`;
