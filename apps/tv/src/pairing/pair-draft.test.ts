import type { FileFeed, PairFileFailure } from '@lablo/data/client';
import type { PairPayload } from '@lablo/protocol';
import { describe, expect, it } from 'vitest';
import type { LoadErrorCode } from '../onboarding/loader';
import { LoadError } from '../onboarding/loader';
import type { FileParts } from './pair-draft';
import { PAIR_GUIDES_MAX, fileError, pairDraft, statusFor } from './pair-draft';

const FEED: FileFeed = { port: { postMessage: () => undefined, onmessage: null } as unknown as FileFeed['port'], size: 3 };
const fetchFile = (): Promise<FileFeed> => Promise.resolve(FEED);
const PARTS: FileParts = { name: 'Playlist from your phone', file: fetchFile };
const FILE = { key: 'k', fileKey: 'f', base: 'b', size: 1 };

/** The phone's payload as a source (RELAY step 31c2a): the TV form's own checks, and each outcome's status. */

describe('pairDraft', () => {
  it("normalizes an Xtream login as the TV form does: the server's base, the trimmed login, the host as the name", () => {
    const payload: PairPayload = { v: 1, source: { type: 'xtream', server: 'Panel.Test:8080/player_api.php?username=a', username: ' user1 ', password: ' secret ' } };
    expect(pairDraft(payload, PARTS)).toEqual({ type: 'xtream', name: 'panel.test', account: { base: 'http://panel.test:8080', username: 'user1', password: 'secret' }, epgUrls: [] });
  });

  it("keeps an Xtream login's guide links too", () => {
    const payload: PairPayload = { v: 1, source: { type: 'xtream', server: 'panel.test', username: 'u', password: 'p' }, epg: ['guides.test/a.xml'] };
    expect(pairDraft(payload, PARTS)?.epgUrls).toEqual(['http://guides.test/a.xml']);
  });

  it('keeps an M3U link with its name trimmed, and its guide links normalized in order, each once', () => {
    const payload: PairPayload = {
      v: 1,
      source: { type: 'm3u', url: 'https://Lists.Test/get.php?username=U&password=P' },
      name: '  Living room ',
      epg: ['lists.test/a.xml', 'http://lists.test/a.xml', 'HTTPS://Guides.Test/b.xml.gz'],
    };
    expect(pairDraft(payload, PARTS)).toEqual({
      type: 'm3u',
      name: 'Living room',
      url: 'https://lists.test/get.php?username=U&password=P',
      epgUrls: ['http://lists.test/a.xml', 'https://guides.test/b.xml.gz'],
    });
  });

  it('names a source by its host when the name is empty or spaces', () => {
    expect(pairDraft({ v: 1, source: { type: 'm3u', url: 'lists.test:81/x.m3u' }, name: '   ' }, PARTS)).toMatchObject({ name: 'lists.test' });
    expect(pairDraft({ v: 1, source: { type: 'm3u', url: 'lists.test/x.m3u' }, name: '' }, PARTS)).toMatchObject({ name: 'lists.test' });
  });

  it(`reads at most ${PAIR_GUIDES_MAX} guide links`, () => {
    const epg = ['g.test/1', 'g.test/2', 'g.test/3', 'g.test/4', 'g.test/5'];
    expect(pairDraft({ v: 1, source: { type: 'm3u', url: 'l.test/a' }, epg }, PARTS)?.epgUrls).toEqual(['http://g.test/1', 'http://g.test/2', 'http://g.test/3', 'http://g.test/4']);
    // A fifth link the form would refuse is never read.
    expect(pairDraft({ v: 1, source: { type: 'm3u', url: 'l.test/a' }, epg: epg.slice(0, 4).concat(['bad link']) }, PARTS)?.epgUrls).toHaveLength(4);
  });

  it.each<[string, PairPayload]>([
    ['a server with another scheme', { v: 1, source: { type: 'xtream', server: 'ftp://panel.test', username: 'u', password: 'p' } }],
    ['a server with a login in it', { v: 1, source: { type: 'xtream', server: 'http://u:p@panel.test', username: 'u', password: 'p' } }],
    ['an empty username', { v: 1, source: { type: 'xtream', server: 'panel.test', username: ' ', password: 'p' } }],
    ['an empty password', { v: 1, source: { type: 'xtream', server: 'panel.test', username: 'u', password: '' } }],
    ['a link with spaces', { v: 1, source: { type: 'm3u', url: 'lists.test/a b.m3u' } }],
    ['a guide link with another scheme', { v: 1, source: { type: 'm3u', url: 'lists.test/a.m3u' }, epg: ['mailto:x@y'] }],
    ['a file with a guide link the form would refuse', { v: 1, source: { type: 'm3u-file', file: FILE }, epg: ['g.test/a', 'bad link'] }],
  ])('refuses %s', (_, payload) => {
    expect(pairDraft(payload, PARTS)).toBeNull();
  });

  it("makes an M3U file's draft (step 31d2b1): its name trimmed, its guide links checked, the screen's fetch", async () => {
    const draft = pairDraft({ v: 1, source: { type: 'm3u-file', file: FILE }, name: '  Kitchen list ', epg: ['g.test/a.xml', 'http://g.test/a.xml', 'https://g.test/b.xml'] }, PARTS);
    expect(draft).toEqual({ type: 'm3u-file', name: 'Kitchen list', epgUrls: ['http://g.test/a.xml', 'https://g.test/b.xml'], file: fetchFile });
    if (draft === null || draft.type !== 'm3u-file') throw new Error('no file draft');
    await expect(draft.file()).resolves.toBe(FEED);
  });

  it("names a file sent without a name, or with only spaces, by the screen's default", () => {
    expect(pairDraft({ v: 1, source: { type: 'm3u-file', file: FILE } }, PARTS)).toMatchObject({ type: 'm3u-file', name: 'Playlist from your phone', epgUrls: [] });
    expect(pairDraft({ v: 1, source: { type: 'm3u-file', file: FILE }, name: '   ' }, PARTS)).toMatchObject({ name: 'Playlist from your phone' });
    expect(pairDraft({ v: 1, source: { type: 'm3u-file', file: FILE }, name: '' }, { name: 'قائمة من هاتفك', file: fetchFile })).toMatchObject({ name: 'قائمة من هاتفك' });
  });
});

describe('fileError', () => {
  it.each<[PairFileFailure, LoadErrorCode]>([
    ['gone', 'file'],
    ['file', 'file'],
    ['network', 'network'],
    ['timeout', 'network'],
    ['rate', 'network'],
    ['status', 'network'],
    ['malformed', 'network'],
    ['too-large', 'network'],
  ])("a file fetch's %s is the load's %s", (failure, code) => {
    const error = fileError(failure);
    expect(error).toBeInstanceOf(LoadError);
    expect(error.code).toBe(code);
  });
});

describe('statusFor', () => {
  it.each<[LoadErrorCode | 'refused', string]>([
    ['auth', 'auth_failed'],
    ['expired', 'expired'],
    ['blocked', 'expired'],
    ['blocklisted', 'blocked'],
    ['refused', 'blocked'],
    ['network', 'unreachable'],
    ['http', 'unreachable'],
    ['format', 'unreachable'],
    ['empty', 'unreachable'],
    ['file', 'unreachable'],
    ['other', 'unreachable'],
  ])('%s is %s', (code, status) => {
    expect(statusFor(code)).toBe(status);
  });
});
