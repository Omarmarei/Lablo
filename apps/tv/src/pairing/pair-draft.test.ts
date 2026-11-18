import type { PairPayload } from '@lablo/protocol';
import { describe, expect, it } from 'vitest';
import type { LoadErrorCode } from '../onboarding/loader';
import { PAIR_GUIDES_MAX, pairDraft, statusFor } from './pair-draft';

/** The phone's payload as a source (RELAY step 31c2a): the TV form's own checks, and each outcome's status. */

describe('pairDraft', () => {
  it("normalizes an Xtream login as the TV form does: the server's base, the trimmed login, the host as the name", () => {
    const payload: PairPayload = { v: 1, source: { type: 'xtream', server: 'Panel.Test:8080/player_api.php?username=a', username: ' user1 ', password: ' secret ' } };
    expect(pairDraft(payload)).toEqual({ type: 'xtream', name: 'panel.test', account: { base: 'http://panel.test:8080', username: 'user1', password: 'secret' }, epgUrls: [] });
  });

  it("keeps an Xtream login's guide links too", () => {
    const payload: PairPayload = { v: 1, source: { type: 'xtream', server: 'panel.test', username: 'u', password: 'p' }, epg: ['guides.test/a.xml'] };
    expect(pairDraft(payload)?.epgUrls).toEqual(['http://guides.test/a.xml']);
  });

  it('keeps an M3U link with its name trimmed, and its guide links normalized in order, each once', () => {
    const payload: PairPayload = {
      v: 1,
      source: { type: 'm3u', url: 'https://Lists.Test/get.php?username=U&password=P' },
      name: '  Living room ',
      epg: ['lists.test/a.xml', 'http://lists.test/a.xml', 'HTTPS://Guides.Test/b.xml.gz'],
    };
    expect(pairDraft(payload)).toEqual({
      type: 'm3u',
      name: 'Living room',
      url: 'https://lists.test/get.php?username=U&password=P',
      epgUrls: ['http://lists.test/a.xml', 'https://guides.test/b.xml.gz'],
    });
  });

  it('names a source by its host when the name is empty or spaces', () => {
    expect(pairDraft({ v: 1, source: { type: 'm3u', url: 'lists.test:81/x.m3u' }, name: '   ' })).toMatchObject({ name: 'lists.test' });
    expect(pairDraft({ v: 1, source: { type: 'm3u', url: 'lists.test/x.m3u' }, name: '' })).toMatchObject({ name: 'lists.test' });
  });

  it(`reads at most ${PAIR_GUIDES_MAX} guide links`, () => {
    const epg = ['g.test/1', 'g.test/2', 'g.test/3', 'g.test/4', 'g.test/5'];
    expect(pairDraft({ v: 1, source: { type: 'm3u', url: 'l.test/a' }, epg })?.epgUrls).toEqual(['http://g.test/1', 'http://g.test/2', 'http://g.test/3', 'http://g.test/4']);
    // A fifth link the form would refuse is never read.
    expect(pairDraft({ v: 1, source: { type: 'm3u', url: 'l.test/a' }, epg: epg.slice(0, 4).concat(['bad link']) })?.epgUrls).toHaveLength(4);
  });

  it.each<[string, PairPayload]>([
    ['a server with another scheme', { v: 1, source: { type: 'xtream', server: 'ftp://panel.test', username: 'u', password: 'p' } }],
    ['a server with a login in it', { v: 1, source: { type: 'xtream', server: 'http://u:p@panel.test', username: 'u', password: 'p' } }],
    ['an empty username', { v: 1, source: { type: 'xtream', server: 'panel.test', username: ' ', password: 'p' } }],
    ['an empty password', { v: 1, source: { type: 'xtream', server: 'panel.test', username: 'u', password: '' } }],
    ['a link with spaces', { v: 1, source: { type: 'm3u', url: 'lists.test/a b.m3u' } }],
    ['a guide link with another scheme', { v: 1, source: { type: 'm3u', url: 'lists.test/a.m3u' }, epg: ['mailto:x@y'] }],
    ['an M3U file (step 31d)', { v: 1, source: { type: 'm3u-file', file: { key: 'k', fileKey: 'f', base: 'b', size: 1 } } }],
  ])('refuses %s', (_, payload) => {
    expect(pairDraft(payload)).toBeNull();
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
    ['other', 'unreachable'],
  ])('%s is %s', (code, status) => {
    expect(statusFor(code)).toBe(status);
  });
});
