// Build fixture (RELAY step 35e): a module the entry and its lazy part both use; one instance.
export let count = 0;

export function tick(): void {
  count += 1;
}

export function label(text: string): string {
  return `[${text}]`;
}
