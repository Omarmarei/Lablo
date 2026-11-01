// Build fixture: ES2018 syntax that Babel cannot transpile. The syntax gate must reject it.
const price = /(?<=\$)\d+/;

(globalThis as unknown as { fixture: unknown }).fixture = { price: (text: string) => price.exec(text)?.[0] };
