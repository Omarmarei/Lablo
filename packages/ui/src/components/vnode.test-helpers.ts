import type { ComponentChildren, VNode } from 'preact';

/** A rendered element as the tests see it: tag, props and children, components expanded. */
export interface El {
  readonly tag: string;
  readonly props: Record<string, unknown>;
  readonly key: unknown;
  readonly children: ReadonlyArray<El | string>;
}

function isVNode(value: unknown): value is VNode {
  return typeof value === 'object' && value !== null && 'type' in value && 'props' in value;
}

function children(value: ComponentChildren): Array<El | string> {
  if (value === null || value === undefined || value === false || value === true || value === '') return [];
  if (Array.isArray(value)) return value.flatMap((child: ComponentChildren) => children(child));
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return [String(value)];
  if (isVNode(value)) return [expand(value)];
  throw new Error(`unexpected child ${String(value)}`);
}

/**
 * Expands a component's output without a DOM: function components are called (ours use no
 * hooks), elements keep their props. Good enough to check structure, classes and handlers.
 */
export function expand(node: VNode): El {
  const props = node.props as Record<string, unknown> & { children?: ComponentChildren };
  if (typeof node.type === 'function') {
    const out = (node.type as (p: unknown) => ComponentChildren)(props);
    const [only, ...rest] = children(out);
    if (only === undefined || typeof only === 'string' || rest.length > 0) throw new Error('a component must render one element');
    return only;
  }
  const { children: kids, ...rest } = props;
  return { tag: String(node.type), props: rest, key: node.key, children: children(kids) };
}

/** Every element of the tree, depth first. */
export function all(el: El): El[] {
  return [el, ...el.children.flatMap((c) => (typeof c === 'string' ? [] : all(c)))];
}

/** The elements whose class list has `cls`. */
export function byClass(el: El, cls: string): El[] {
  return all(el).filter((e) => typeof e.props.class === 'string' && e.props.class.split(' ').indexOf(cls) >= 0);
}

export function one(el: El, cls: string): El {
  const found = byClass(el, cls);
  if (found.length !== 1) throw new Error(`${found.length} elements with class ${cls}`);
  return found[0]!;
}

/** The text of the tree, as a screen reader would read it. */
export function text(el: El | string): string {
  return typeof el === 'string' ? el : el.children.map(text).join('');
}
