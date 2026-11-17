import { describe, expect, it } from 'vitest';
import { BLOCKLIST_HOST_MAX, blocklistCandidates, blocklistHost } from './blocklist-host';

describe('blocklistHost', () => {
  it('lowercases ASCII and drops one trailing dot', () => {
    expect(blocklistHost('Example.COM')).toBe('example.com');
    expect(blocklistHost('example.com.')).toBe('example.com');
    expect(blocklistHost('TV.Example.com.')).toBe('tv.example.com');
    expect(blocklistHost('localhost')).toBe('localhost');
  });

  it('keeps digits, hyphens, underscores and punycode labels', () => {
    expect(blocklistHost('cdn-2_live.xn--mgbh0fb.example')).toBe('cdn-2_live.xn--mgbh0fb.example');
    expect(blocklistHost('-odd-.example')).toBe('-odd-.example');
  });

  it('takes IP addresses as written', () => {
    expect(blocklistHost('203.0.113.7')).toBe('203.0.113.7');
    expect(blocklistHost('127.1')).toBe('127.1');
    expect(blocklistHost('[2001:DB8::1]')).toBe('[2001:db8::1]');
    expect(blocklistHost('[::ffff:203.0.113.7]')).toBe('[::ffff:203.0.113.7]');
  });

  it('refuses what is not a bare host', () => {
    for (const input of [
      '',
      '.',
      'example..com',
      '.example.com',
      'example.com..',
      'example.com:8080',
      'example.com/path',
      'user@example.com',
      'http://example.com',
      ' example.com',
      'example.com ',
      'exa mple.com',
      '2001:db8::1',
      '[2001:db8::1',
      '[2001:db8::1]:80',
      '[]',
      '[:]x',
      '[gggg::1]',
    ]) {
      expect(blocklistHost(input), input).toBeNull();
    }
  });

  it('refuses non-ASCII hosts (the TV gives punycode, the operator the xn-- form)', () => {
    expect(blocklistHost('مثال.example')).toBeNull();
    expect(blocklistHost('BÜCHER.example')).toBeNull();
    expect(blocklistHost('xn--bcher-kva.example')).toBe('xn--bcher-kva.example');
    // A Unicode capital that lowercases to ASCII is still refused (Kelvin sign).
    expect(blocklistHost(`${String.fromCharCode(0x212a)}elvin.example`)).toBeNull();
  });

  it('holds labels to 63 characters and the host to 253', () => {
    const label63 = 'a'.repeat(63);
    expect(blocklistHost(`${label63}.example`)).toBe(`${label63}.example`);
    expect(blocklistHost(`${label63}a.example`)).toBeNull();
    // 4 × 63 + 3 dots = 255 > 253; 3 × 63 + 61 + 3 = 253.
    const longest = `${label63}.${label63}.${label63}.${'b'.repeat(61)}`;
    expect(longest.length).toBe(BLOCKLIST_HOST_MAX);
    expect(blocklistHost(longest)).toBe(longest);
    expect(blocklistHost(`${longest}.`)).toBe(longest);
    expect(blocklistHost(`${label63}.${label63}.${label63}.${'b'.repeat(62)}`)).toBeNull();
    expect(BLOCKLIST_HOST_MAX).toBe(253);
  });
});

describe('blocklistCandidates', () => {
  it('gives the host, then each parent down to the last label', () => {
    expect(blocklistCandidates('a.b.example.com')).toStrictEqual(['a.b.example.com', 'b.example.com', 'example.com', 'com']);
    expect(blocklistCandidates('example.com')).toStrictEqual(['example.com', 'com']);
    expect(blocklistCandidates('localhost')).toStrictEqual(['localhost']);
  });

  it('gives an IP address alone', () => {
    expect(blocklistCandidates('203.0.113.7')).toStrictEqual(['203.0.113.7']);
    expect(blocklistCandidates('[2001:db8::1]')).toStrictEqual(['[2001:db8::1]']);
    expect(blocklistCandidates('[::ffff:203.0.113.7]')).toStrictEqual(['[::ffff:203.0.113.7]']);
    // Not four numbers: a name like any other.
    expect(blocklistCandidates('127.1')).toStrictEqual(['127.1', '1']);
    expect(blocklistCandidates('1.2.3.4.example')).toStrictEqual(['1.2.3.4.example', '2.3.4.example', '3.4.example', '4.example', 'example']);
  });
});
