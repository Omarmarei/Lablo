import { createHash } from 'node:crypto';
import { domainToASCII } from 'node:url';
import { describe, expect, it } from 'vitest';
import { blocklistHost } from '@lablo/core';
import { Blocklist, asciiHost, punycode, urlHost } from './blocklist';

// Non-ASCII text is built from code points: the source stays ASCII.
const cp = (...points: number[]): string => String.fromCodePoint(...points);
const SALT = 'QtHj17D-F3HxhSWwfvhERM83_Cu0K5lHS7cQ_PczpBA';
/** The signer's hash, by Node's own SHA-256: base64url of SHA-256(UTF-8(salt + host)). */
const hashOf = (host: string): string => createHash('sha256').update(SALT + host, 'utf8').digest('base64url');

describe('urlHost', () => {
  it('gives the host of each usual stream and panel URL', () => {
    expect(urlHost('http://panel.example.com:8080/get.php?username=u&password=p')).toBe('panel.example.com');
    expect(urlHost('https://cdn.example.com/live/1.m3u8')).toBe('cdn.example.com');
    expect(urlHost('http://Panel.Example.COM')).toBe('Panel.Example.COM');
    expect(urlHost('rtmp://media.example.net/live/stream')).toBe('media.example.net');
    expect(urlHost('udp://239.0.0.1:1234')).toBe('239.0.0.1');
    expect(urlHost('http://10.0.0.5:25461/live/u/p/1.ts')).toBe('10.0.0.5');
  });

  it('drops the login, port, query and fragment', () => {
    expect(urlHost('http://user:pa:ss@host.example:81/x')).toBe('host.example');
    expect(urlHost('http://a@b@host.example/x')).toBe('host.example');
    expect(urlHost('http://host.example?x=@evil.example')).toBe('host.example');
    expect(urlHost('http://host.example#@evil.example')).toBe('host.example');
    expect(urlHost('http://host.example:8080')).toBe('host.example');
    expect(urlHost('http://host.example:')).toBe('host.example');
    expect(urlHost('http://@host.example/x')).toBe('host.example');
    expect(urlHost('http://host.example/a:b@c')).toBe('host.example');
    expect(urlHost('http://host.example?a:b')).toBe('host.example');
  });

  it('keeps an IPv6 address in its brackets', () => {
    expect(urlHost('http://[2001:db8::1]:8080/live')).toBe('[2001:db8::1]');
    expect(urlHost('http://u:p@[::1]/')).toBe('[::1]');
    expect(urlHost('http://[2001:db8::1/live')).toBeNull();
    expect(urlHost('http://[::1/x]')).toBeNull();
  });

  it('reads http-like URLs as browsers do: backslashes, extra slashes, blanks', () => {
    expect(urlHost('http:\\\\host.example\\path')).toBe('host.example');
    expect(urlHost('https:/host.example/x')).toBe('host.example');
    expect(urlHost('HTTP:host.example/x')).toBe('host.example');
    expect(urlHost('http:///host.example')).toBe('host.example');
    expect(urlHost('  http://host.example/x  ')).toBe('host.example');
    expect(urlHost('http://host.example \t')).toBe('host.example');
    expect(urlHost(String.fromCharCode(1) + 'http://host.example' + String.fromCharCode(31))).toBe('host.example');
    for (const scheme of ['ws', 'wss', 'ftp', 'https']) {
      expect(urlHost(scheme + ':/host.example')).toBe('host.example');
      expect(urlHost(scheme + ':\\host.example\\x')).toBe('host.example');
    }
    expect(urlHost('ht\ttp://ho\nst.exa\rmple/x')).toBe('host.example');
    expect(urlHost('ws://host.example') + ' ' + urlHost('wss://host.example') + ' ' + urlHost('ftp://host.example')).toBe('host.example host.example host.example');
  });

  it('needs two slashes for other schemes, where a backslash is no slash', () => {
    expect(urlHost('rtmp:host.example/x')).toBeNull();
    expect(urlHost('rtmp:/host.example/x')).toBeNull();
    expect(urlHost('rtsp://host.example\\x/y')).toBe('host.example\\x');
    expect(urlHost('rtsp://host.example?x')).toBe('host.example');
  });

  it('has no host without a scheme and an authority', () => {
    for (const bad of ['', 'host.example/x', '//host.example/x', '/live/1.ts', '1http://host.example', 'ht~tp://host.example', 'http//host.example', 'http://', 'http://:80/x', 'http://u@/x', 'rtmp://', 'mailto:me@host.example', '   ']) {
      expect(urlHost(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('allows the scheme characters', () => {
    expect(urlHost('a+b-c.d://host.example/')).toBe('host.example');
    expect(urlHost('h2://host.example/')).toBe('host.example');
  });
});

describe('punycode (RFC 3492)', () => {
  it("encodes RFC 3492 section 7.1's samples", () => {
    // (A) Arabic (Egyptian), (B) Chinese (simplified), (L) Japanese 3<nen>B<gumi><kinpachi><sensei>, (S) -> $1.00 <-
    expect(punycode(cp(0x0644, 0x064a, 0x0647, 0x0645, 0x0627, 0x0628, 0x062a, 0x0643, 0x0644, 0x0645, 0x0648, 0x0634, 0x0639, 0x0631, 0x0628, 0x064a, 0x061f))).toBe('egbpdaj6bu4bxfgehfvwxn');
    expect(punycode(cp(0x4ed6, 0x4eec, 0x4e3a, 0x4ec0, 0x4e48, 0x4e0d, 0x8bf4, 0x4e2d, 0x6587))).toBe('ihqwcrb4cv8a8dqg056pqjye');
    expect(punycode('3' + cp(0x5e74) + 'b' + cp(0x7d44, 0x91d1, 0x516b, 0x5148, 0x751f))).toBe('3b-ww4c5e180e575a65lsy2b');
    expect(punycode('-> $1.00 <-')).toBe('-> $1.00 <--');
  });

  it('encodes the usual IDN samples', () => {
    expect(punycode('m' + cp(0xfc) + 'nchen')).toBe('mnchen-3ya');
    expect(punycode(cp(0x2603))).toBe('n3h');
    expect(punycode(cp(0x1f600))).toBe('e28h');
    expect(punycode('abc')).toBe('abc-');
    expect(punycode('')).toBe('');
  });

  it('refuses a lone surrogate', () => {
    expect(punycode('a' + String.fromCharCode(0xd83d))).toBeNull();
    expect(punycode(String.fromCharCode(0xd83d) + 'a')).toBeNull();
    expect(punycode(String.fromCharCode(0xde00) + 'a')).toBeNull();
    expect(punycode(String.fromCharCode(0xd83d, 0xd83d))).toBeNull();
    expect(punycode(String.fromCharCode(0xde00, 0xde00))).toBeNull();
    expect(punycode(String.fromCharCode(0xd83d, 0xe000))).toBeNull();
  });
});

describe('asciiHost', () => {
  it('lowercases an ASCII host and drops one trailing dot', () => {
    expect(asciiHost('Panel.Example.COM.')).toBe('panel.example.com');
    expect(asciiHost('XN--MNCHEN-3YA.de')).toBe('xn--mnchen-3ya.de');
    expect(asciiHost('10.0.0.5')).toBe('10.0.0.5');
    expect(asciiHost('[2001:DB8::1]')).toBe('[2001:db8::1]');
  });

  it('turns a Unicode host into its xn-- form', () => {
    expect(asciiHost(cp(0x645, 0x62b, 0x627, 0x644) + '.' + cp(0x625, 0x62e, 0x62a, 0x628, 0x627, 0x631))).toBe('xn--mgbh0fb.xn--kgbechtv');
    expect(asciiHost('M' + cp(0xdc) + 'nchen.DE')).toBe('xn--mnchen-3ya.de');
    expect(asciiHost('tv.M' + cp(0xdc) + 'nchen.DE.')).toBe('tv.xn--mnchen-3ya.de');
    expect(asciiHost(cp(0x4f8b, 0x5b50) + '.com')).toBe('xn--fsqu00a.com');
  });

  it('maps as browsers do: full width, ligatures, a capital sigma, ignored code points, ideographic dots', () => {
    expect(asciiHost(cp(0xff25, 0xff38) + 'ample' + cp(0xff0e) + 'com')).toBe('example.com');
    expect(asciiHost(cp(0xfb03) + '.com')).toBe('ffi.com');
    expect(asciiHost(cp(0x212a) + 'elvin.com')).toBe('kelvin.com');
    expect(asciiHost(cp(0x391, 0x3a3) + '.gr')).toBe('xn--mxa0b.gr');
    expect(asciiHost('ex' + cp(0xad) + 'am' + cp(0x200b) + 'ple.com')).toBe('example.com');
    expect(asciiHost('example' + cp(0x3002) + 'com')).toBe('example.com');
    expect(asciiHost('example' + cp(0xff61) + 'com')).toBe('example.com');
    expect(asciiHost('e' + cp(0x301) + 'x.com')).toBe('xn--x-9fa.com');
  });

  // UTS #46 changes with Unicode: these follow the current one (Unicode 17, as Node 24's
  // `domainToASCII` has it: Ada 3.4's IDNA tables, not ICU's). Node 22's (CI's) older tables map
  // U+1E9E to "ss" and refuse some code points the current one ignores, so the answers are pinned
  // here, and Node is asked only when its IDNA is that new (it maps U+1E9E to the sharp s).
  const CURRENT_IDNA = domainToASCII('a' + cp(0x1e9e) + 'b.com') === 'xn--ab-gia.com';

  /** Letters a simple mapping gets wrong (case, compatibility forms, composition, astral capitals), as `a<letters>b.com`. */
  const LETTERS: [number[], string][] = [
    [[0x3f9], 'xn--ab-vbc.com'],
    [[0x3aa, 0x301], 'xn--ab-i6b.com'],
    [[0x3ab, 0x301], 'xn--ab-88b.com'],
    [[0x130], 'xn--aib-9dc.com'],
    [[0x1e9e], 'xn--ab-gia.com'],
    [[0xdf], 'xn--ab-gia.com'],
    [[0x3c2], 'xn--ab-sbc.com'],
    [[0x3a3], 'xn--ab-vbc.com'],
    [[0x212a], 'akb.com'],
    [[0x2126], 'xn--ab-ecc.com'],
    [[0x1c5], 'xn--adb-d3a.com'],
    [[0xfb03], 'affib.com'],
    [[0x10400], 'xn--ab-w16n.com'],
    [[0x1d400], 'aab.com'],
    [[0xff21, 0x301], 'xn--ab-mia.com'],
  ];

  /** The code points UTS #46 ignores, first-last (Unicode 17). */
  const IGNORED_RANGES = [
    [0xad, 0xad],
    [0x34f, 0x34f],
    [0x115f, 0x1160],
    [0x17b4, 0x17b5],
    [0x180b, 0x180f],
    [0x200b, 0x200b],
    [0x2060, 0x2064],
    [0x206a, 0x206f],
    [0x3164, 0x3164],
    [0xfe00, 0xfe0f],
    [0xfeff, 0xfeff],
    [0xffa0, 0xffa0],
    [0x1bca0, 0x1bca3],
    [0x1d173, 0x1d17a],
    [0xe0100, 0xe01ef],
  ];
  /** Every BMP code point but the surrogates, and the astral ignored ranges with a margin. */
  const ignoredCandidates = (): number[] => {
    const points: number[] = [];
    for (let c = 0x80; c <= 0xffff; c++) if (c < 0xd800 || c > 0xdfff) points.push(c);
    for (const [from, to] of [
      [0x1bc9e, 0x1bca5],
      [0x1d171, 0x1d17c],
      [0xe00fe, 0xe01f1],
    ]) {
      for (let c = from!; c <= to!; c++) points.push(c);
    }
    return points;
  };
  const isIgnored = (c: number) => IGNORED_RANGES.some(([from, to]) => c >= from! && c <= to!);
  const vanishes = (c: number, map: (host: string) => string | null) => map('ex' + cp(c) + 'ample.com') === 'example.com';

  it('maps the letters a simple mapping gets wrong as the current UTS #46 does', () => {
    for (const [points, expected] of LETTERS) expect(asciiHost('a' + cp(...points) + 'b.com'), points.map((p) => p.toString(16)).join('+')).toBe(expected);
  });

  it('drops exactly the code points the current UTS #46 ignores', () => {
    const differ = ignoredCandidates().filter((c) => vanishes(c, asciiHost) !== isIgnored(c));
    expect(differ.map((c) => c.toString(16))).toEqual([]);
  });

  it.runIf(CURRENT_IDNA)("pins the same answers Node's own IDNA gives (when it is the current UTS #46)", () => {
    for (const [points, expected] of LETTERS) expect(domainToASCII('a' + cp(...points) + 'b.com')).toBe(expected);
    const differ = ignoredCandidates().filter((c) => vanishes(c, domainToASCII) !== isIgnored(c));
    expect(differ.map((c) => c.toString(16))).toEqual([]);
  });

  it('decodes percent escapes first', () => {
    expect(asciiHost('ex%61mple.com')).toBe('example.com');
    expect(asciiHost('m%C3%BCnchen.de')).toBe('xn--mnchen-3ya.de');
    expect(asciiHost('ex%zzample.com')).toBeNull();
    expect(asciiHost('ex%C3ample.com')).toBeNull();
    expect(asciiHost('ex%2Fample.com')).toBeNull();
    // An IPv6 address is read before any escape, as URL parsers read it.
    expect(asciiHost('[%3A%3A1]')).toBeNull();
  });

  it('refuses what has no blocklist form', () => {
    for (const bad of ['', 'a..b', 'host:80', 'a b.com', 'x'.repeat(64) + '.com', '[::1', 'ex' + String.fromCharCode(0xd800) + '.com']) {
      expect(asciiHost(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("agrees with Node's url.domainToASCII wherever Node gives an answer", () => {
    // Each label in one script (Latin with Latin-1, Greek, Cyrillic, Arabic, Hebrew, CJK, Hangul,
    // full-width Latin) or in all of them mixed, with capitals, digits, hyphens, ligatures, the
    // Kelvin sign, ignored code points, a combining accent, an emoji and the dots that aren't
    // `.`; a seeded generator, so a failure repeats.
    const range = (from: number, to: number): number[] => {
      const out: number[] = [];
      for (let c = from; c <= to; c++) out.push(c);
      return out;
    };
    const extras = [0x2d, 0x2d, 0x30, 0x37, 0x39, 0xad, 0x200b, 0xfb01, 0x212a, 0x301, 0x1f600, 0x2603];
    const scripts = [
      [...range(0x61, 0x7a), ...range(0x41, 0x5a), ...range(0xc0, 0xd6), ...range(0xd8, 0xf6), ...range(0xf8, 0xff)],
      [...range(0x391, 0x3a1), ...range(0x3a3, 0x3a9), ...range(0x3b1, 0x3c9)],
      range(0x410, 0x44f),
      range(0x628, 0x63a),
      range(0x5d0, 0x5ea),
      range(0x4e00, 0x4e40),
      range(0xac00, 0xac40),
      [...range(0xff21, 0xff3a), ...range(0xff41, 0xff5a)],
    ];
    const everything = scripts.flat();
    const dots = ['.', '.', '.', String.fromCharCode(0x3002), String.fromCharCode(0xff0e), String.fromCharCode(0xff61)];
    let seed = 20261117;
    const next = (n: number): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 8) % n;
    };
    let compared = 0;
    let unicode = 0;
    for (let run = 0; run < 4000; run++) {
      let host = '';
      const count = 1 + next(3);
      for (let l = 0; l < count; l++) {
        const letters = next(10) === 0 ? everything : scripts[next(scripts.length)]!;
        const length = 1 + next(12);
        for (let i = 0; i < length; i++) host += cp(next(6) === 0 ? extras[next(extras.length)]! : letters[next(letters.length)]!);
        host += dots[next(dots.length)];
      }
      // A last label of letters keeps Node from reading the host as an IPv4 address.
      host += 'c' + cp(0x61 + next(26)) + 'm';
      const node = domainToASCII(host);
      if (node === '') continue;
      const expected = blocklistHost(node);
      expect(asciiHost(host), `${JSON.stringify(host)} -> ${node}`).toBe(expected);
      compared++;
      if ([...host].some((c) => c.charCodeAt(0) > 127)) unicode++;
    }
    expect(compared).toBeGreaterThan(2500);
    expect(unicode).toBeGreaterThan(2000);
  });
});

describe('Blocklist', () => {
  const list = new Blocklist(SALT, [hashOf('blocked.example'), hashOf('xn--mnchen-3ya.de'), hashOf('10.0.0.5'), hashOf('[2001:db8::1]'), hashOf('blocked.example')]);

  it('counts each hash once', () => {
    expect(list.size).toBe(4);
    expect(new Blocklist(SALT, []).size).toBe(0);
  });

  it('blocks a listed host and everything under it', () => {
    expect(list.blocksHost('blocked.example')).toBe(true);
    expect(list.blocksHost('Blocked.Example.')).toBe(true);
    expect(list.blocksHost('cdn.blocked.example')).toBe(true);
    expect(list.blocksHost('a.b.c.blocked.example')).toBe(true);
    expect(list.blocksUrl('http://user:pw@live.blocked.example:8080/get.php?x=1')).toBe(true);
  });

  it('leaves other hosts alone, including look-alikes and parents', () => {
    expect(list.blocksHost('example')).toBe(false);
    expect(list.blocksHost('notblocked.example')).toBe(false);
    expect(list.blocksHost('blocked.example.com')).toBe(false);
    expect(list.blocksUrl('http://blocked.example.com/x')).toBe(false);
    expect(list.blocksUrl('http://other.example/?u=blocked.example')).toBe(false);
  });

  it('blocks a Unicode host by its xn-- form', () => {
    expect(list.blocksHost('m' + cp(0xfc) + 'nchen.de')).toBe(true);
    expect(list.blocksUrl('http://tv.M' + cp(0xdc) + 'NCHEN.de/live')).toBe(true);
    expect(list.blocksUrl('http://tv.m%C3%BCnchen.de/live')).toBe(true);
  });

  it('takes an IP address as written, without parents', () => {
    expect(list.blocksUrl('http://10.0.0.5:25461/live/1.ts')).toBe(true);
    expect(list.blocksUrl('http://10.0.0.6/live/1.ts')).toBe(false);
    expect(list.blocksUrl('http://[2001:DB8::1]:80/x')).toBe(true);
    expect(new Blocklist(SALT, [hashOf('0.0.5')]).blocksHost('10.0.0.5')).toBe(false);
    expect(new Blocklist(SALT, [hashOf('5')]).blocksHost('10.0.0.5')).toBe(false);
  });

  it('blocks a whole top-level domain when it is listed', () => {
    expect(new Blocklist(SALT, [hashOf('example')]).blocksUrl('http://a.b.example/x')).toBe(true);
  });

  it('blocks nothing it cannot read, and nothing with an empty list', () => {
    expect(list.blocksUrl('not a url')).toBe(false);
    expect(list.blocksHost('a..blocked.example')).toBe(false);
    expect(new Blocklist(SALT, []).blocksUrl('http://blocked.example/')).toBe(false);
    expect(new Blocklist(SALT, []).blocksHost('blocked.example')).toBe(false);
  });

  it('hashes under its own salt', () => {
    expect(new Blocklist('another-salt-0123', [hashOf('blocked.example')]).blocksHost('blocked.example')).toBe(false);
  });

  it('is not fooled by keys an object already has', () => {
    const proto = new Blocklist(SALT, ['constructor', '__proto__', 'toString']);
    expect(proto.size).toBe(3);
    expect(proto.blocksHost('example.com')).toBe(false);
  });
});
