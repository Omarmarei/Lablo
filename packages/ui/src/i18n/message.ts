import type { PluralCategory } from '@lablo/core';

/**
 * Catalog messages: a small subset of ICU MessageFormat (RELAY step 12, ADR-011), enough for a
 * TV app's sentences and the `pseudoLocalize` brace rule (text at an even brace depth is text):
 *
 * - `{name}`: an argument. A string is the provider's text or another message, and the runtime
 *   isolates it (core's isolateText: FSI…PDI plus marks); a number is formatted in the locale's digits.
 * - `{n, number}`: a number argument, said explicitly.
 * - `{n, plural, =0 {…} zero {…} one {…} two {…} few {…} many {…} other {…}}`: the branch for
 *   an exact `=N` first, then the plural category, then `other` (required). `#` in a branch is
 *   `n` in the locale's digits; in a select nested in that branch it is plain text, as in ICU's
 *   MessagePattern.
 * - `{kind, select, live {…} vod {…} other {…}}`: a branch by the argument's text, else `other`.
 *
 * Not supported: ICU's apostrophe quoting. Text can't contain `{` or `}`; `#` is plain text
 * outside a plural branch. `test` checks that every catalog message parses.
 */
export type MessagePart = string | ArgumentPart | NumberPart | CountPart | PluralPart | SelectPart;

export interface ArgumentPart {
  readonly type: 'argument';
  readonly name: string;
}
export interface NumberPart {
  readonly type: 'number';
  readonly name: string;
}
/** `#` in a plural branch. */
export interface CountPart {
  readonly type: 'count';
}
export interface PluralPart {
  readonly type: 'plural';
  readonly name: string;
  readonly branches: Readonly<Record<string, readonly MessagePart[]>>;
}
export interface SelectPart {
  readonly type: 'select';
  readonly name: string;
  readonly branches: Readonly<Record<string, readonly MessagePart[]>>;
}

export class MessageSyntaxError extends Error {
  constructor(
    readonly reason: string,
    readonly position: number,
  ) {
    super(`${reason} at ${position}`);
    this.name = 'MessageSyntaxError';
  }
}

const PLURAL_KEYS: readonly string[] = ['zero', 'one', 'two', 'few', 'many', 'other'];
const COUNT: CountPart = { type: 'count' };

function isNameChar(c: string): boolean {
  return /^[A-Za-z0-9_]$/.test(c);
}

class Parser {
  private i = 0;

  constructor(private readonly source: string) {}

  parse(): MessagePart[] {
    const parts = this.parts(false);
    if (this.i < this.source.length) this.fail('unmatched }');
    return parts;
  }

  private fail(reason: string): never {
    throw new MessageSyntaxError(reason, this.i);
  }

  private peek(): string {
    return this.source.charAt(this.i);
  }

  private space(): void {
    while (/^\s$/.test(this.peek())) this.i += 1;
  }

  private name(): string {
    const start = this.i;
    while (this.i < this.source.length && isNameChar(this.peek())) this.i += 1;
    return this.source.slice(start, this.i);
  }

  private expect(c: string): void {
    if (this.peek() !== c) this.fail(`expected ${c}`);
    this.i += 1;
  }

  /** Text and arguments up to an unmatched `}` or the end. */
  private parts(inPlural: boolean): MessagePart[] {
    const out: MessagePart[] = [];
    let text = '';
    while (this.i < this.source.length) {
      const c = this.peek();
      if (c === '}') break;
      if (c === '{' || (c === '#' && inPlural)) {
        if (text !== '') out.push(text);
        text = '';
        if (c === '#') {
          out.push(COUNT);
          this.i += 1;
        } else {
          out.push(this.argument());
        }
      } else {
        text += c;
        this.i += 1;
      }
    }
    if (text !== '') out.push(text);
    return out;
  }

  private argument(): MessagePart {
    this.expect('{');
    this.space();
    const name = this.name();
    if (name === '') this.fail('expected an argument name');
    this.space();
    if (this.i >= this.source.length) this.fail('unclosed argument');
    if (this.peek() === '}') {
      this.i += 1;
      return { type: 'argument', name };
    }
    this.expect(',');
    this.space();
    const kind = this.name();
    this.space();
    if (kind === 'number') {
      this.expect('}');
      return { type: 'number', name };
    }
    if (kind !== 'plural' && kind !== 'select') this.fail(`unknown argument type "${kind}"`);
    this.expect(',');
    this.space();
    const branches: Record<string, readonly MessagePart[]> = Object.create(null) as Record<string, readonly MessagePart[]>;
    while (this.peek() !== '}') {
      if (this.i >= this.source.length) this.fail('unclosed argument');
      const exact = this.peek() === '=' && kind === 'plural';
      if (exact) this.i += 1;
      const key = this.name();
      if (exact ? !/^\d+$/.test(key) : key === '') this.fail('expected a branch key');
      if (kind === 'plural' && !exact && PLURAL_KEYS.indexOf(key) < 0) this.fail(`unknown plural category "${key}"`);
      const branchKey = exact ? `=${key}` : key;
      if (branches[branchKey] !== undefined) this.fail(`duplicate branch "${branchKey}"`);
      this.space();
      this.expect('{');
      branches[branchKey] = this.parts(kind === 'plural');
      this.expect('}');
      this.space();
    }
    if (branches['other'] === undefined) this.fail('a plural or select needs an other branch');
    this.i += 1;
    return { type: kind, name, branches };
  }
}

/** Parses a catalog message; throws `MessageSyntaxError` with the position. */
export function parseMessage(source: string): MessagePart[] {
  return new Parser(source).parse();
}

/** What a message's arguments may be: text (isolated when shown) or a number. */
export type MessageArgs = Readonly<Record<string, string | number>>;

/** The locale's side of formatting, supplied by the runtime. */
export interface MessageEnv {
  plural(n: number): PluralCategory;
  /** A number in the locale's digits. */
  number(n: number): string;
  /** A text argument as it goes into the sentence (the runtime isolates it). */
  text(value: string): string;
}

function shown(name: string): string {
  return `{${name}}`;
}

function toNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number(value);
}

/**
 * Formats parsed parts. A missing argument stays visible as `{name}`, so a gap shows on screen
 * and in tests rather than as an empty string.
 */
export function formatMessage(parts: readonly MessagePart[], args: MessageArgs | undefined, env: MessageEnv, count?: number): string {
  let out = '';
  for (const part of parts) {
    if (typeof part === 'string') {
      out += part;
      continue;
    }
    if (part.type === 'count') {
      out += count === undefined ? '#' : env.number(count);
      continue;
    }
    const value = args === undefined ? undefined : args[part.name];
    if (value === undefined) {
      out += shown(part.name);
    } else if (part.type === 'argument') {
      out += typeof value === 'number' ? env.number(value) : env.text(value);
    } else if (part.type === 'number') {
      out += env.number(toNumber(value));
    } else if (part.type === 'plural') {
      const n = toNumber(value);
      const branch = part.branches[`=${n}`] ?? part.branches[env.plural(n)] ?? part.branches['other'] ?? [];
      out += formatMessage(branch, args, env, n);
    } else {
      // A select's branches hold no `#` (the parser reads it as text there), so no count goes in.
      const branch = part.branches[String(value)] ?? part.branches['other'] ?? [];
      out += formatMessage(branch, args, env);
    }
  }
  return out;
}

/** Each argument a message uses, with its kind, in first-use order (for the catalog checks). */
export function messageArguments(parts: readonly MessagePart[]): string[] {
  const found: Record<string, string> = Object.create(null) as Record<string, string>;
  const walk = (list: readonly MessagePart[]): void => {
    for (const part of list) {
      if (typeof part === 'string' || part.type === 'count') continue;
      found[part.name] = part.type;
      if (part.type === 'plural' || part.type === 'select') {
        for (const key of Object.keys(part.branches)) walk(part.branches[key] ?? []);
      }
    }
  };
  walk(parts);
  return Object.keys(found).map((name) => `${name}:${found[name] ?? ''}`);
}

/** The branch keys of each plural argument in source order, e.g. `n: =0 one other`. */
export function pluralBranches(parts: readonly MessagePart[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly MessagePart[]): void => {
    for (const part of list) {
      if (typeof part === 'string' || part.type === 'count' || part.type === 'argument' || part.type === 'number') continue;
      const keys = Object.keys(part.branches);
      if (part.type === 'plural') out.push(`${part.name}: ${keys.join(' ')}`);
      for (const key of keys) walk(part.branches[key] ?? []);
    }
  };
  walk(parts);
  return out;
}
