// Logins and links in the profile (RELAY step 32d4a): what a backup without them leaves out and keeps.
import { describe, expect, it } from 'vitest';
import type { RefreshSource } from './logins';
import { backupDoc, lacksLogin, linkOrigin, withoutLogins } from './logins';
import type { AnyProfile, ProfileDoc } from './profile';
import { emptyProfile } from './profile';

const XTREAM = { id: 's1', type: 'xtream', name: 'Panel', account: { base: 'http://panel.test:8080', username: 'user-xt-1', password: 'pass-xt-1' }, added: 1 };
const LINK = { id: 's2', type: 'm3u', name: 'Living room', url: 'http://Lists.Test:8000/get.php?username=user-m3u-2&password=pass-m3u-2', added: 2 };
const FILE = { id: 's3', type: 'm3u-file', name: 'Kitchen', added: 3 };
/** A source a backup without logins brought back already. */
const BARE = { id: 's4', type: 'm3u', name: 'Den', url: null, origin: 'https://den.test', added: 4 };
const GUIDE = { id: 's2', url: 'http://epg.test/token-g-1/guide.xml', offsetMinutes: 60 };
const GUIDE_PLAIN = { id: 'g2', url: 'https://guides.test:8443/x.xml?key=key-g-2' };
const GUIDE_BARE = { id: 'g3', url: null, origin: 'http://old.test' };
const ITEM = {
  key: 'x:s1:live:7',
  src: 's1',
  kind: 'live',
  name: 'News',
  normName: 'news',
  group: 'News',
  url: 'http://panel.test:8080/live/user-xt-1/pass-xt-1/7.ts',
  logo: 'http://logos.test/7.png',
  epgId: 'news.tv',
  tvgName: null,
  matchName: 'news',
  chno: 7,
  tvgShift: 0,
  catchup: { mode: 'xc', days: 3, source: 'http://panel.test:8080/timeshift/user-xt-1/pass-xt-1/{duration}/{start}/7.ts' },
  radio: false,
  hints: { userAgent: 'VLC', referrer: null },
};
const LAST = { item: ITEM, number: 7, category: { src: 's1', name: 'News' }, index: 0, started: 9 };
const OTHER = { item: { ...ITEM, key: 'x:s1:live:8', name: 'Sport', url: 'http://panel.test:8080/live/user-xt-1/pass-xt-1/8.ts', catchup: null }, number: 8, category: null, index: 3, started: 8 };
/** Every login and link the document holds: none may be in a stripped one. */
const SECRETS = ['user-xt-1', 'pass-xt-1', 'user-m3u-2', 'pass-m3u-2', 'get.php', 'token-g-1', 'guide.xml', 'key-g-2', 'x.xml', '/live/', 'timeshift'];

function fullDoc(): ProfileDoc {
  return {
    ...emptyProfile(),
    onboarding: { language: 'ar', disclaimerAt: 5, consent: true },
    sources: [XTREAM, LINK, FILE, BARE],
    guides: [GUIDE, GUIDE_PLAIN, GUIDE_BARE],
    favourites: [{ key: 'x:s1:live:7', src: 's1', kind: 'live', normName: 'news', added: 3, missingSince: null }],
    player: { last: LAST, containers: { s1: 'ts' }, redirects: { s2: 'none' }, tracks: {}, subtitleSize: 'm' },
    channels: [LAST, OTHER],
    progress: { 'x:s1:movie:201': { positionMs: 30_000, lengthMs: 596_000, updated: 7 } },
    epgOffsets: { 'u~s2': 60 },
    epgOverrides: { 'x:s1:live:7': { epgSrc: 'u~g2', channel: 'news.tv' } },
    backupLogins: false,
  } as unknown as ProfileDoc;
}

/** What the full document is without its logins, field by field. */
function strippedDoc(): AnyProfile {
  const doc = fullDoc() as unknown as AnyProfile;
  const bare = (item: Record<string, unknown>) => ({ ...item, url: '', catchup: null });
  return {
    ...doc,
    sources: [
      { id: 's1', type: 'xtream', name: 'Panel', account: null, added: 1, base: 'http://panel.test:8080' },
      { id: 's2', type: 'm3u', name: 'Living room', url: null, added: 2, origin: 'http://lists.test:8000' },
      FILE,
      BARE,
    ],
    guides: [
      { id: 's2', url: null, offsetMinutes: 60, origin: 'http://epg.test' },
      { id: 'g2', url: null, origin: 'https://guides.test:8443' },
      GUIDE_BARE,
    ],
    player: { last: { ...LAST, item: bare(ITEM) }, containers: { s1: 'ts' }, redirects: { s2: 'none' }, tracks: {}, subtitleSize: 'm' },
    channels: [
      { ...LAST, item: bare(ITEM) },
      { ...OTHER, item: bare(OTHER.item) },
    ],
  };
}

describe('lacksLogin', () => {
  it('says which refresh sources have no login on the TV', () => {
    const cases: [RefreshSource, boolean][] = [
      [{ type: 'xtream', account: { base: 'http://p.test', username: 'u', password: 'p' } }, false],
      [{ type: 'xtream', account: null, base: 'http://p.test' }, true],
      [{ type: 'm3u', url: 'http://l.test/a.m3u' }, false],
      [{ type: 'm3u', url: '' }, false],
      [{ type: 'm3u', url: null, origin: 'http://l.test' }, true],
      [{ type: 'm3u-file' }, false],
    ];
    for (const [source, lacks] of cases) expect([source, lacksLogin(source)]).toEqual([source, lacks]);
  });
});

describe('linkOrigin', () => {
  it("keeps a link's scheme, host and port, in lower case", () => {
    expect(linkOrigin('http://Lists.Test:8000/get.php?username=u&password=p')).toBe('http://lists.test:8000');
    expect(linkOrigin('HTTPS://EPG.test/a/b.xml')).toBe('https://epg.test');
    expect(linkOrigin('http://epg.test?key=k')).toBe('http://epg.test');
    expect(linkOrigin('http://epg.test#k')).toBe('http://epg.test');
    expect(linkOrigin('http://epg.test\\k')).toBe('http://epg.test');
    expect(linkOrigin('http://epg.test')).toBe('http://epg.test');
    expect(linkOrigin('http://10.0.0.2:80/x')).toBe('http://10.0.0.2:80');
  });

  it('keeps nothing of a link whose authority is more than a host and a port, or that is not http(s)', () => {
    for (const url of [
      'http://user:pass@lists.test/a.m3u',
      'http://pass@lists.test',
      'http://lists.test:pass@x/',
      'http://lists.test:123456/a',
      'http://lists.test:/a',
      'http://lists test/a',
      'http:///a.m3u',
      'ftp://lists.test/a.m3u',
      'lists.test/a.m3u',
      'https',
      'a?next=http://lists.test',
      '',
    ]) {
      expect([url, linkOrigin(url)]).toEqual([url, '']);
    }
  });
});

describe('withoutLogins', () => {
  it('leaves out every login and link, and keeps everything else in its place', () => {
    const doc = fullDoc();
    const before = JSON.stringify(doc);
    const stripped = withoutLogins(doc as unknown as AnyProfile);
    expect(stripped).toEqual(strippedDoc());
    // Field by field, in the same order: the same JSON as the expected document.
    expect(JSON.stringify(stripped)).toBe(JSON.stringify(strippedDoc()));
    const json = JSON.stringify(stripped);
    for (const secret of SECRETS) expect([secret, json.indexOf(secret)]).toEqual([secret, -1]);
    // The stored document is left alone.
    expect(JSON.stringify(doc)).toBe(before);
    expect(stripped).not.toBe(doc);
  });

  it('gives the same JSON stripped twice, and after a login is given back', () => {
    const once = withoutLogins(fullDoc() as unknown as AnyProfile);
    expect(JSON.stringify(withoutLogins(once))).toBe(JSON.stringify(once));
    // The login given back (32d4b): the source stored whole again, the guide's link again.
    const given = { ...once, sources: [XTREAM, LINK, FILE, BARE], guides: [GUIDE, GUIDE_PLAIN, GUIDE_BARE] };
    expect(JSON.stringify(withoutLogins(given))).toBe(JSON.stringify(once));
  });

  it('keeps nothing of a login it cannot read, and leaves what is not a source, guide or channel as it is', () => {
    const odd = {
      v: 9,
      sources: [null, 'x', { id: 's1', type: 'xtream', name: 'A', account: 'user:pass', added: 1 }, { id: 's2', type: 'xtream', name: 'B', account: { username: 'u' }, added: 1 }, { id: 's3', type: 'm3u', name: 'C', url: 5, added: 1 }, { id: 's4', type: 'stalker', url: 'http://s.test/u/p' }],
      guides: [7, { id: 'g1', url: 9 }, { id: 'g2' }],
      player: { last: null },
      channels: [null, { item: 'x', number: 1 }, { number: 2 }],
    };
    expect(withoutLogins(odd)).toEqual({
      v: 9,
      sources: [null, 'x', { id: 's1', type: 'xtream', name: 'A', account: null, added: 1, base: '' }, { id: 's2', type: 'xtream', name: 'B', account: null, added: 1, base: '' }, { id: 's3', type: 'm3u', name: 'C', url: null, added: 1, origin: '' }, { id: 's4', type: 'stalker', url: 'http://s.test/u/p' }],
      guides: [7, { id: 'g1', url: null, origin: '' }, { id: 'g2', url: null, origin: '' }],
      player: { last: null },
      channels: [null, { item: 'x', number: 1 }, { number: 2 }],
    });
    // Lists that aren't lists, and a player that isn't one: as they are, nothing added.
    expect(withoutLogins({ v: 9, sources: 's1', guides: null, player: 'p' })).toEqual({ v: 9, sources: 's1', guides: null, player: 'p' });
    expect(Object.keys(withoutLogins({ v: 9 }))).toEqual(['v']);
  });
});

describe('backupDoc', () => {
  it('strips only a document that says so', () => {
    const off = fullDoc() as unknown as AnyProfile;
    expect(backupDoc(off)).toEqual(strippedDoc());
    for (const on of [undefined, true, 'false', 0]) {
      const doc = { ...off, backupLogins: on } as AnyProfile;
      expect(backupDoc(doc)).toBe(doc);
    }
    const none = { ...off } as AnyProfile;
    delete none['backupLogins'];
    expect(backupDoc(none)).toBe(none);
  });
});
