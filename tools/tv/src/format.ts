/**
 * JSON for a terminal: objects indented, but an array whose items each fit on one line stays on
 * one line (`"heapMB": [[0, 10], [5, 11]]` instead of one number per line). The text is still JSON.
 */
export function formatJson(value: unknown, indent = ''): string {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    const items = value.map((item: unknown) => (item === undefined ? 'null' : formatJson(item, inner)));
    if (items.every((item) => !item.includes('\n'))) return `[${items.join(', ')}]`;
    return `[\n${items.map((item) => `${inner}${item}`).join(',\n')}\n${indent}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    if (entries.length === 0) return '{}';
    return `{\n${entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${formatJson(item, inner)}`).join(',\n')}\n${indent}}`;
  }
  return (JSON.stringify(value) as string | undefined) ?? String(value);
}
