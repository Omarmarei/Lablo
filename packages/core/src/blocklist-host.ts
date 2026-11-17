/**
 * The blocklist's form of a host (architecture.md §3.3 C). The signed config lists
 * `blocklistHash(salt, host)` of each blocked host; `tools/sign-config` hashes the hosts an
 * operator gives in this form, and the TV (RELAY step 30b) hashes every host it meets in this
 * form, with each of its parents, so the two sides agree byte for byte.
 *
 * ES2017 and no `split` or `Array.from`: this runs in the TV bundle (Babel adds core-js
 * polyfills by name).
 */

/** The longest host DNS allows. */
export const BLOCKLIST_HOST_MAX = 253;

/** One label: letters, digits, `-` and `_` (seen in real hosts), 1 to 63 characters. */
const LABEL = /^[a-z0-9_-]{1,63}$/;
/** Four dotted numbers: an IPv4 address, which has no parents. */
const IPV4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
/** An IPv6 address in brackets, as URLs write it. */
const IPV6 = /^\[[0-9a-f:.]{2,45}\]$/;
const UPPER = /[A-Z]/g;

/**
 * The host as the blocklist hashes it: ASCII lowercase, without one trailing dot; an IPv6
 * address keeps its brackets. `null` for anything else: a non-ASCII host (the TV turns one into
 * punycode first, step 30b; an operator gives the `xn--` form), a port, a path, a login, an
 * empty label, or more than 253 characters.
 *
 * An IP address is taken as written: `127.1` or a long IPv6 form are not rewritten.
 */
export function blocklistHost(input: string): string | null {
  let host = input.replace(UPPER, (c) => c.toLowerCase());
  if (host.length > 0 && host.charCodeAt(host.length - 1) === 46 /* . */) host = host.slice(0, -1);
  if (host.length > BLOCKLIST_HOST_MAX) return null;
  if (host.charCodeAt(0) === 91 /* [ */) return IPV6.test(host) ? host : null;
  let start = 0;
  while (start <= host.length) {
    let end = host.indexOf('.', start);
    if (end === -1) end = host.length;
    if (!LABEL.test(host.slice(start, end))) return null;
    start = end + 1;
  }
  return host;
}

/**
 * The hosts whose hashes block `host` (a `blocklistHost` result): the host itself, then each
 * parent down to the last label (`a.b.example.com`, `b.example.com`, `example.com`, `com`). An IP
 * address has no parents.
 */
export function blocklistCandidates(host: string): string[] {
  const hosts = [host];
  if (host.charCodeAt(0) === 91 /* [ */ || IPV4.test(host)) return hosts;
  let at = host.indexOf('.');
  while (at !== -1) {
    hosts.push(host.slice(at + 1));
    at = host.indexOf('.', at + 1);
  }
  return hosts;
}
