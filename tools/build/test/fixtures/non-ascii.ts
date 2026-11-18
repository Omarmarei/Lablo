// Build fixture: non-ASCII text in strings and regexes. main.js is written as UTF-8
// (bundle.ts), except what an ES2016 script or a UTF-8 file can't hold as it is.
const arabic = 'مرحبًا بعودتك';
const isolated = '\u2068x\u2069';
const separators = 'a\u2028b\u2029c';
const bom = '\ufeffd';
const lone = '\ud800e';
const pair = '\ud83d\ude00';
const letters = /[\u0621-\u064a]+/;
const lineEnds = /[\u2028\u2029]/;
const highSurrogate = /[\ud800-\udbff]/;

(globalThis as unknown as { fixture: unknown }).fixture = {
  strings: [arabic, isolated, separators, bom, lone, pair],
  letters: letters.test(arabic),
  lineEnds: lineEnds.test(separators),
  highSurrogate: highSurrogate.test(lone),
};

// A module, so Babel injects its polyfills as imports (a script would get `require`).
export {};
