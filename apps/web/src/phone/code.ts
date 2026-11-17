/**
 * The pairing code as people type it, and the QR link's fragment (RELAY step 31b, architecture.md
 * §3.3 A). The TV shows 8 Crockford base32 characters; a person may type them in lower case, with
 * spaces or a dash between the halves, and may read 1 as I or L and 0 as O.
 */
import { bytes32, pairCode } from '@lablo/protocol';

/** The code's characters a person may put between groups. */
const SEPARATORS = /[\s-]+/g;
/** Crockford's reading of the letters it leaves out: I and L are 1, O is 0. */
const READ_AS: Readonly<Record<string, string>> = { I: '1', L: '1', O: '0' };

/** The code as the TV made it, or null when what was typed can't be one (U, a symbol, a length). */
export function normalizeCode(input: string): string | null {
  const code = input
    .replace(SEPARATORS, '')
    .toUpperCase()
    .replace(/[ILO]/g, (letter) => READ_AS[letter]!);
  return pairCode.safeParse(code).success ? code : null;
}

/** The code in two groups of four, as the TV shows it. */
export function groupCode(code: string): string {
  return `${code.slice(0, 4)} ${code.slice(4)}`;
}

/** What the QR link carries after `#`: the code and the TV's public key. */
export interface QrTarget {
  readonly code: string;
  /** The TV's X25519 public key, base64url (from the TV's screen, never from the server). */
  readonly tvPk: string;
}

/**
 * The code and the key from the QR link's fragment (`#c=<code>&k=<tvPk>`), or null when either is
 * missing or malformed. The fragment never reaches the server.
 */
export function readFragment(hash: string): QrTarget | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const code = normalizeCode(params.get('c') ?? '');
  const tvPk = params.get('k') ?? '';
  if (code === null || !bytes32.safeParse(tvPk).success) return null;
  return { code, tvPk };
}
