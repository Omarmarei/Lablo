import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FormValues } from './form';
import { FORM_FIELDS, checkForm, firstProblem, linkHost, normalizeLink } from './form';

describe('normalizeLink (a link typed on a remote)', () => {
  it.each([
    ['http://provider.example/get.php?x=1', 'http://provider.example/get.php?x=1'],
    ['  https://provider.example:8080/list.m3u  ', 'https://provider.example:8080/list.m3u'],
    // No scheme: http:// is assumed (TV keyboards make :// slow to type).
    ['provider.example/list.m3u', 'http://provider.example/list.m3u'],
    ['provider.example:8080', 'http://provider.example:8080'],
    // The scheme and host are case-insensitive; the path and query are not.
    ['HTTPS://Provider.Example:8080/List.M3U?Token=AbC', 'https://provider.example:8080/List.M3U?Token=AbC'],
    ['http://10.0.0.5:8080?x', 'http://10.0.0.5:8080?x'],
    ['http://host#frag', 'http://host#frag'],
  ])('%j -> %j', (input, link) => {
    expect(normalizeLink(input)).toBe(link);
  });

  it.each([
    '',
    '   ',
    'http://',
    'https:///path',
    'http://:8080',
    'ftp://provider.example/list.m3u',
    'file:///etc/passwd',
    'http://provider example/list',
    'http://provider.example/a list.m3u',
    'http://user:pass@provider.example/list.m3u',
    'http://user@provider.example/list.m3u',
    'http://provider.example:123456',
    'http://provider.example:port',
  ])('refuses %j', (input) => {
    expect(normalizeLink(input)).toBeNull();
  });

  it('never throws, and what it returns is an http(s) link without spaces', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const link = normalizeLink(input);
        if (link === null) return;
        expect(link).toMatch(/^https?:\/\/[^\s/?#:@]+(:\d{1,5})?([/?#]\S*)?$/);
      }),
    );
  });
});

describe('linkHost', () => {
  it.each([
    ['http://provider.example:8080/list', 'provider.example'],
    ['https://provider.example?x=1', 'provider.example'],
    ['http://10.0.0.5', '10.0.0.5'],
    ['http://h#x', 'h'],
  ])('%s -> %s', (link, host) => {
    expect(linkHost(link)).toBe(host);
  });
});

describe('checkForm (before anything is fetched)', () => {
  const xtream: FormValues = { server: 'provider.example:8080', username: ' user1 ', password: 'secret ' };

  it('requires the server, the username and the password of an Xtream login', () => {
    const checked = checkForm('xtream', {});
    expect(checked.problems).toEqual({ server: 'required', username: 'required', password: 'required' });
    expect(checked.draft).toBeNull();
    // Spaces only is empty.
    expect(checkForm('xtream', { server: ' ', username: '  ', password: '\t' }).problems).toEqual({ server: 'required', username: 'required', password: 'required' });
  });

  it('gives an Xtream login with the server normalized, the login trimmed and the host as its name', () => {
    expect(checkForm('xtream', xtream)).toEqual({
      problems: {},
      draft: {
        type: 'xtream',
        name: 'provider.example',
        account: { base: 'http://provider.example:8080', username: 'user1', password: 'secret' },
        epgUrl: null,
      },
    });
  });

  it('takes a pasted panel link as the server, and the name and guide given', () => {
    const checked = checkForm('xtream', { ...xtream, server: 'http://Provider.Example:8080/player_api.php?username=a&password=b', epg: 'provider.example/xmltv.php', name: '  Home  ' });
    expect(checked.draft).toMatchObject({ name: 'Home', account: { base: 'http://provider.example:8080' }, epgUrl: 'http://provider.example/xmltv.php' });
  });

  it.each([
    ['provider example', 'spaces'],
    ['ftp://provider.example', 'url'],
    ['http://user:pw@provider.example', 'url'],
  ])('refuses the server %j (%s)', (server, problem) => {
    const checked = checkForm('xtream', { ...xtream, server });
    expect(checked.problems).toEqual({ server: problem });
    expect(checked.draft).toBeNull();
  });

  it('refuses a bad guide link, which is optional when empty', () => {
    expect(checkForm('xtream', { ...xtream, epg: 'http://guide example' }).problems).toEqual({ epg: 'spaces' });
    expect(checkForm('xtream', { ...xtream, epg: 'mailto:x@y' }).problems).toEqual({ epg: 'url' });
    expect(checkForm('xtream', { ...xtream, epg: '   ' }).draft).toMatchObject({ epgUrl: null });
  });

  it('reports every problem at once', () => {
    expect(checkForm('xtream', { server: 'a b', epg: 'x y' }).problems).toEqual({ server: 'spaces', username: 'required', password: 'required', epg: 'spaces' });
  });

  it('requires an M3U link and gives its host as the name', () => {
    expect(checkForm('m3u', {}).problems).toEqual({ playlist: 'required' });
    expect(checkForm('m3u', { playlist: 'provider.example/list.m3u' })).toEqual({
      problems: {},
      draft: { type: 'm3u', name: 'provider.example', url: 'http://provider.example/list.m3u', epgUrl: null },
    });
    expect(checkForm('m3u', { playlist: 'https://p.example/a b.m3u' }).problems).toEqual({ playlist: 'spaces' });
  });

  it('ignores the other type\'s fields', () => {
    expect(checkForm('m3u', { playlist: 'p.example/l.m3u', server: 'x y', username: '' }).problems).toEqual({});
    expect(checkForm('xtream', { ...xtream, playlist: 'a b' }).problems).toEqual({});
  });

  it('gives a source exactly when nothing is refused, and never throws', () => {
    const text = fc.oneof(fc.string(), fc.constantFrom('', ' ', 'provider.example', 'http://p.example:80/x', 'a b', 'ftp://x'));
    fc.assert(
      fc.property(fc.constantFrom('xtream' as const, 'm3u' as const), fc.record({ server: text, username: text, password: text, playlist: text, epg: text, name: text }), (type, values) => {
        const checked = checkForm(type, values);
        expect(checked.draft === null).toBe(Object.keys(checked.problems).length > 0);
        const ids = FORM_FIELDS[type].map((f) => f.id as string);
        for (const id of Object.keys(checked.problems)) expect(ids).toContain(id);
      }),
    );
  });
});

describe('firstProblem', () => {
  it('finds the first refused field in screen order', () => {
    expect(firstProblem('xtream', { password: 'required', server: 'url' })).toBe(0);
    expect(firstProblem('xtream', { name: 'required', epg: 'url' })).toBe(3);
    expect(firstProblem('m3u', { epg: 'spaces' })).toBe(1);
    expect(firstProblem('m3u', {})).toBe(-1);
  });
});
