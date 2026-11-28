// Build fixture: syntax newer than Chromium 68 that Babel cannot transpile (the regex `d` flag,
// ES2022, Chromium 90). The syntax gate must reject it.
const price = /\$(\d+)/d;

(globalThis as unknown as { fixture: unknown }).fixture = { price: (text: string) => price.exec(text)?.[1] };
