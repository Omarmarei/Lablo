import { boxKeyPairFromSecretKey, fileCipherLength, toBase64Url } from '@lablo/crypto';
import { PAIR_FILE_MAX_BYTES, pairPayloadSchema } from '@lablo/protocol';
import { describe, expect, it } from 'vitest';
import { groupCode, normalizeCode, readFragment } from '../src/phone/code';
import type { FormValues } from '../src/phone/form';
import { checkForm, EMPTY_VALUES, FILE_MAX_BYTES, fileProblem, firstProblem, nameFromFile, normalizeLink, REQUIRED, withFile } from '../src/phone/form';

/** The phone page's typed code, QR fragment and forms (RELAY step 31b). */

const KEY = toBase64Url(boxKeyPairFromSecretKey(new Uint8Array(32).fill(7)).publicKey);

describe('normalizeCode', () => {
  it.each([
    ['7K3MQ9XD', '7K3MQ9XD'],
    ['7k3mq9xd', '7K3MQ9XD'],
    ['7K3M Q9XD', '7K3MQ9XD'],
    ['7K3M-Q9XD', '7K3MQ9XD'],
    ['  7k3m - q9xd  ', '7K3MQ9XD'],
    ['7K3M\tQ9XD', '7K3MQ9XD'],
    // Crockford's readings: I and L are 1, O is 0, in either case.
    ['IL0OilOo', '11001100'],
    ['ABCDEFGH', 'ABCDEFGH'],
  ])('reads %j as %s', (typed, code) => {
    expect(normalizeCode(typed)).toBe(code);
  });

  it.each([['ABCDEFG'], ['ABCDEFGHJ'], [''], ['ABCD EFGU'], ['ABCD_EFGH'], ['ABCD.EFGH'], ['ABCDÉFGH'], ['ABCD+EFGH']])('refuses %j', (typed) => {
    expect(normalizeCode(typed)).toBeNull();
  });

  it('groups a code as the TV shows it', () => {
    expect(groupCode('7K3MQ9XD')).toBe('7K3M Q9XD');
  });
});

describe('readFragment', () => {
  it('reads the code and the key, with or without the #', () => {
    expect(readFragment(`#c=7K3MQ9XD&k=${KEY}`)).toEqual({ code: '7K3MQ9XD', tvPk: KEY });
    expect(readFragment(`k=${KEY}&c=7k3m-q9xd`)).toEqual({ code: '7K3MQ9XD', tvPk: KEY });
  });

  it.each([
    ['', 'nothing'],
    ['#', 'an empty fragment'],
    [`#k=${KEY}`, 'no code'],
    ['#c=7K3MQ9XD', 'no key'],
    [`#c=7K3MQ9X&k=${KEY}`, 'a short code'],
    [`#c=7K3MQ9XU&k=${KEY}`, 'a U'],
    [`#c=7K3MQ9XD&k=${KEY.slice(1)}`, 'a short key'],
    [`#c=7K3MQ9XD&k=${KEY}A`, 'a long key'],
    [`#c=7K3MQ9XD&k=${KEY.slice(0, -1)}B`, 'a key with unused bits set'],
    [`#c=7K3MQ9XD&k=${KEY.slice(0, 10)}+${KEY.slice(11)}`, 'a key outside base64url'],
  ])('refuses %j (%s)', (hash) => {
    expect(readFragment(hash)).toBeNull();
  });
});

describe('normalizeLink', () => {
  it.each([
    ['example.com', 'http://example.com'],
    ['  Example.COM:8080/Path?Q=A#F ', 'http://example.com:8080/Path?Q=A#F'],
    ['HTTPS://Lists.Example/get.php', 'https://lists.example/get.php'],
    ['http://1.2.3.4:80', 'http://1.2.3.4:80'],
    ['example.com?x=1', 'http://example.com?x=1'],
    ['example.com#x', 'http://example.com#x'],
  ])('reads %j as %s', (typed, link) => {
    expect(normalizeLink(typed)).toBe(link);
  });

  it.each([[''], ['   '], ['exa mple.com'], ['ftp://example.com'], ['http://'], ['http://user:pass@example.com'], ['http://example.com:123456'], ['http://:80'], ['rtmp://example.com/live'], ['httpx://example.com'], ['xhttp://example.com']])(
    'refuses %j',
    (typed) => {
      expect(normalizeLink(typed)).toBeNull();
    },
  );
});

const XTREAM: FormValues = { ...EMPTY_VALUES, server: ' Example.com:8080 ', username: ' user ', password: ' p@ss word ' };

describe('checkForm', () => {
  it('gives the Xtream payload: the link normalized, the login trimmed, nothing optional', () => {
    const checked = checkForm('xtream', XTREAM);
    expect(checked).toEqual({ problems: {}, payload: { v: 1, source: { type: 'xtream', server: 'http://example.com:8080', username: 'user', password: 'p@ss word' } } });
    expect(pairPayloadSchema.parse(checked.payload)).toEqual(checked.payload);
  });

  it('gives the M3U payload with its guide links (empty ones dropped) and its name', () => {
    const checked = checkForm('m3u', { ...EMPTY_VALUES, playlist: 'lists.example/a.m3u', epg: ['', ' epg.example/a.xml ', '   ', 'https://b.example/b.xml'], name: '  Salon  ' });
    expect(checked.problems).toEqual({});
    expect(checked.payload).toEqual({ v: 1, source: { type: 'm3u', url: 'http://lists.example/a.m3u' }, name: 'Salon', epg: ['http://epg.example/a.xml', 'https://b.example/b.xml'] });
  });

  it('reads only the chosen type’s fields', () => {
    expect(checkForm('m3u', { ...XTREAM, playlist: 'https://a.example/x.m3u' }).payload?.source).toEqual({ type: 'm3u', url: 'https://a.example/x.m3u' });
    expect(checkForm('xtream', { ...XTREAM, playlist: 'not a link' }).problems).toEqual({});
  });

  it('refuses each empty required field', () => {
    expect(checkForm('xtream', EMPTY_VALUES)).toEqual({ problems: { server: 'required', username: 'required', password: 'required' }, payload: null });
    expect(checkForm('xtream', { ...XTREAM, username: '   ' }).problems).toEqual({ username: 'required' });
    expect(checkForm('m3u', EMPTY_VALUES)).toEqual({ problems: { playlist: 'required' }, payload: null });
    expect(REQUIRED).toEqual({ xtream: ['server', 'username', 'password'], m3u: ['playlist'], file: [] });
  });

  it('names a link’s problem: spaces, or not an http(s) address', () => {
    expect(checkForm('xtream', { ...XTREAM, server: 'exa mple.com' }).problems).toEqual({ server: 'spaces' });
    expect(checkForm('xtream', { ...XTREAM, server: 'ftp://example.com' }).problems).toEqual({ server: 'url' });
    expect(checkForm('m3u', { ...EMPTY_VALUES, playlist: 'http://u:p@a.example' }).problems).toEqual({ playlist: 'url' });
    const checked = checkForm('m3u', { ...EMPTY_VALUES, playlist: 'https://a.example', epg: ['https://ok.example', 'bad link', 'mailto:x@y'] });
    expect(checked).toEqual({ problems: { epg1: 'spaces', epg2: 'url' }, payload: null });
  });

  it('keeps a required field’s problem over its link problem', () => {
    expect(checkForm('xtream', { ...XTREAM, server: '  ' }).problems).toEqual({ server: 'required' });
  });

  it('refuses what the protocol finds too long, on its field', () => {
    const long = (n: number): string => `https://a.example/${'x'.repeat(n - 18)}`;
    expect(long(2048)).toHaveLength(2048);
    expect(checkForm('m3u', { ...EMPTY_VALUES, playlist: long(2048) }).problems).toEqual({});
    expect(checkForm('m3u', { ...EMPTY_VALUES, playlist: long(2049) })).toEqual({ problems: { playlist: 'long' }, payload: null });
    expect(checkForm('xtream', { ...XTREAM, server: long(2049) }).problems).toEqual({ server: 'long' });
    expect(checkForm('xtream', { ...XTREAM, username: 'u'.repeat(257) }).problems).toEqual({ username: 'long' });
    expect(checkForm('xtream', { ...XTREAM, password: 'p'.repeat(257) }).problems).toEqual({ password: 'long' });
    expect(checkForm('xtream', { ...XTREAM, password: 'p'.repeat(256), name: 'n'.repeat(80) }).problems).toEqual({});
    expect(checkForm('xtream', { ...XTREAM, name: 'n'.repeat(81) }).problems).toEqual({ name: 'long' });
    // The field the guide link was typed in, though an empty one before it is dropped.
    expect(checkForm('m3u', { ...EMPTY_VALUES, playlist: 'https://a.example', epg: ['', long(2049)] }).problems).toEqual({ epg1: 'long' });
  });

  it('takes at most four guide links', () => {
    const epg = ['a.example', 'b.example', 'c.example', 'd.example', 'e.example'];
    expect(checkForm('m3u', { ...EMPTY_VALUES, playlist: 'https://a.example', epg }).payload?.epg).toEqual(['http://a.example', 'http://b.example', 'http://c.example', 'http://d.example']);
  });
});

describe('the file form (RELAY step 31d1)', () => {
  const FILE = { name: 'Living room.M3U8', size: 2_500_000 };
  const PENDING = { key: 'A'.repeat(22), fileKey: 'A'.repeat(43), base: 'A'.repeat(32) };

  it('checks the payload with the file’s size, its keys left to the upload', () => {
    const checked = checkForm('file', { ...EMPTY_VALUES, epg: ['epg.example/a.xml'] }, FILE);
    expect(checked).toEqual({ problems: {}, payload: { v: 1, source: { type: 'm3u-file', file: { ...PENDING, size: 2_500_000 } }, name: 'Living room', epg: ['http://epg.example/a.xml'] } });
    // The other types' fields don't count.
    expect(checkForm('file', { ...XTREAM, playlist: 'not a link' }, FILE).problems).toEqual({});
    // And the other types never look at a file.
    expect(checkForm('m3u', { ...EMPTY_VALUES, playlist: 'a.example' }, null).problems).toEqual({});
  });

  it('refuses no file, an empty file and one too large, on its field', () => {
    expect(checkForm('file', EMPTY_VALUES)).toEqual({ problems: { file: 'noFile' }, payload: null });
    expect(checkForm('file', EMPTY_VALUES, { name: 'a.m3u', size: 0 })).toEqual({ problems: { file: 'empty' }, payload: null });
    expect(checkForm('file', EMPTY_VALUES, { name: 'a.m3u', size: FILE_MAX_BYTES + 1 })).toEqual({ problems: { file: 'large' }, payload: null });
    expect(checkForm('file', { ...EMPTY_VALUES, epg: ['bad link'] }, { name: 'a.m3u', size: 0 }).problems).toEqual({ file: 'empty', epg0: 'spaces' });
    expect(checkForm('file', EMPTY_VALUES, { name: 'a.m3u', size: FILE_MAX_BYTES }).problems).toEqual({});
    expect(checkForm('file', EMPTY_VALUES, { name: 'a.m3u', size: 1 }).problems).toEqual({});
  });

  it('takes the largest file whose frames fit the upload limit', () => {
    expect(fileCipherLength(FILE_MAX_BYTES)).toBe(PAIR_FILE_MAX_BYTES);
    expect(fileCipherLength(FILE_MAX_BYTES + 1)).toBeGreaterThan(PAIR_FILE_MAX_BYTES);
    expect([fileProblem(null), fileProblem({ name: '', size: 0 }), fileProblem({ name: '', size: FILE_MAX_BYTES }), fileProblem({ name: '', size: FILE_MAX_BYTES + 1 })]).toEqual(['noFile', 'empty', null, 'large']);
  });

  it('names the source after the file unless a name was typed', () => {
    expect(checkForm('file', { ...EMPTY_VALUES, name: '  Salon ' }, FILE).payload?.name).toBe('Salon');
    expect(checkForm('file', EMPTY_VALUES, { name: '.m3u', size: 5 }).payload).not.toHaveProperty('name');
    expect(checkForm('m3u', { ...EMPTY_VALUES, playlist: 'a.example' }, FILE).payload).not.toHaveProperty('name');
  });

  it.each([
    ['Living room.M3U8', 'Living room'],
    ['list.m3u', 'list'],
    ['list.m3u8.txt', 'list.m3u8.txt'],
    ['  spaced .m3u ', 'spaced .m3u'],
    ['  spaced .m3u', 'spaced'],
    ['.m3u8', ''],
    ['m3u', 'm3u'],
    [`${'n'.repeat(85)}.m3u`, 'n'.repeat(80)],
    [`     ${'n'.repeat(80)}.m3u`, 'n'.repeat(80)],
    // A cut in the middle of a pair drops its first half.
    [`${'n'.repeat(79)}${String.fromCodePoint(0x1f4fa)}.m3u`, 'n'.repeat(79)],
    [`${'n'.repeat(78)}${String.fromCodePoint(0x1f4fa)}.m3u`, `${'n'.repeat(78)}${String.fromCodePoint(0x1f4fa)}`],
    // Spaces left before the cut go too.
    [`a${' '.repeat(78)}${String.fromCodePoint(0x1f4fa)}.m3u`, 'a'],
  ])('names %j %j', (file, name) => {
    expect(nameFromFile(file)).toBe(name);
  });

  it('puts the upload’s keys in the payload, through the schema', () => {
    const checked = checkForm('file', EMPTY_VALUES, FILE).payload!;
    const file = { key: 'k'.repeat(21) + 'w', fileKey: 'f'.repeat(42) + 'E', base: 'b'.repeat(32), size: 2_500_000 };
    expect(withFile(checked, file)).toEqual({ ...checked, source: { type: 'm3u-file', file } });
    expect(() => withFile(checked, { ...file, fileKey: 'short' })).toThrow();
  });
});

describe('firstProblem', () => {
  it('goes in screen order: the type’s fields, the guide links, the name', () => {
    const values: FormValues = { ...EMPTY_VALUES, epg: ['', ''] };
    expect(firstProblem('file', values, { name: 'long', epg0: 'url', file: 'empty' })).toBe('file');
    expect(firstProblem('file', values, { name: 'long', server: 'required' })).toBe('name');
    expect(firstProblem('xtream', values, { name: 'long', epg1: 'url', password: 'required' })).toBe('password');
    expect(firstProblem('xtream', values, { name: 'long', epg1: 'url' })).toBe('epg1');
    expect(firstProblem('m3u', values, { name: 'long' })).toBe('name');
    expect(firstProblem('m3u', values, {})).toBeNull();
    expect(firstProblem('m3u', values, { server: 'required' })).toBeNull();
  });
});
