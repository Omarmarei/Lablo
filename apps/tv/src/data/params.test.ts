import { describe, expect, it } from 'vitest';
import { readApiBase, readChecks, readDebugParams, readParams, readRestored, readScreen, restartUrl } from './params';

const MOCK = 'http://127.0.0.1:8080/get.php?username=u&password=p&type=m3u_plus';

describe('readDebugParams', () => {
  it('has nothing to do without parameters', () => {
    expect(readDebugParams('')).toEqual({ source: null, query: null, force: false, error: null });
    expect(readDebugParams('?tier=low&locale=ar-SA')).toEqual({ source: null, query: null, force: false, error: null });
  });

  it('takes a pasted playlist URL, with its own ? and &, as the last parameter', () => {
    expect(readDebugParams(`?source=${MOCK}`)).toEqual({ source: MOCK, query: null, force: false, error: null });
    expect(readDebugParams(`?tier=low&q=sky news&source=${MOCK}`)).toEqual({ source: MOCK, query: 'sky news', force: false, error: null });
  });

  it('decodes a percent-encoded source and query', () => {
    const q = encodeURIComponent('اخبار');
    expect(readDebugParams(`?q=${q}&source=${encodeURIComponent(MOCK)}`)).toEqual({ source: MOCK, query: 'اخبار', force: false, error: null });
    expect(readDebugParams('?q=sky+news')).toEqual({ source: null, query: 'sky news', force: false, error: null });
  });

  it('only matches a whole source parameter', () => {
    expect(readDebugParams('?q=opensource=x').source).toBeNull();
    expect(readDebugParams('?xsource=http://a.b/c').source).toBeNull();
  });

  it('rejects anything but an http(s) URL', () => {
    expect(readDebugParams('?source=')).toEqual({ source: null, query: null, force: false, error: '?source= is empty' });
    expect(readDebugParams('?source=file:///etc/passwd').error).toBe('?source= must be an http:// or https:// URL');
    expect(readDebugParams('?source=javascript:alert(1)').error).toBe('?source= must be an http:// or https:// URL');
    expect(readDebugParams('?source=%E0%A4%A').error).toBe('?source= is empty');
    expect(readDebugParams('?q=a&source=https://x.example/list.m3u')).toEqual({ source: 'https://x.example/list.m3u', query: 'a', force: false, error: null });
  });

  it('reads force=1 before the source', () => {
    expect(readDebugParams(`?force=1&q=x&source=${MOCK}`)).toEqual({ source: MOCK, query: 'x', force: true, error: null });
    expect(readDebugParams('?force=0').force).toBe(false);
    expect(readDebugParams('?force').force).toBe(false);
    // After the source it is part of the playlist URL.
    expect(readDebugParams(`?source=${MOCK}&force=1`)).toEqual({ source: `${MOCK}&force=1`, query: null, force: false, error: null });
  });

  it('ignores an empty or broken query', () => {
    expect(readDebugParams('?q=').query).toBeNull();
    expect(readDebugParams('?q=+').query).toBeNull();
    expect(readDebugParams('?q=%E0%A4%A').query).toBeNull();
  });
});

describe('readScreen', () => {
  it.each([
    // Onboarding is the start screen (RELAY step 13a); the others are developer screens.
    ['', 'onboarding'],
    ['?locale=ar-SA', 'onboarding'],
    ['?screen=gallery', 'gallery'],
    ['?locale=ar-SA&screen=gallery&tier=low', 'gallery'],
    ['?screen=gallery-guide', 'gallery-guide'],
    ['?locale=ar-SA&screen=gallery-guide', 'gallery-guide'],
    ['?screen=gallery-guides', 'onboarding'],
    ['?screen=hello', 'hello'],
    ['?screen=hello&force=1&q=news', 'hello'],
    ['?screen=Gallery', 'onboarding'],
    ['?screen=HELLO', 'onboarding'],
    ['?screen=onboarding', 'onboarding'],
    ['?screen=', 'onboarding'],
    ['?myscreen=gallery', 'onboarding'],
    // A source's own parameters are not the app's.
    [`?source=${MOCK}&screen=gallery`, 'onboarding'],
    [`?source=${MOCK}&screen=hello`, 'onboarding'],
    [`?screen=gallery&source=${MOCK}`, 'gallery'],
    [`?screen=hello&q=news&source=${MOCK}`, 'hello'],
  ])('%s -> %s', (search, screen) => {
    expect(readScreen(search)).toBe(screen);
  });
});

describe('readParams', () => {
  it('gives every value of one name, decoded and trimmed, in order', () => {
    expect(readParams('?check=a&q=x&check=b+c&check=%41', 'check')).toEqual(['a', 'b c', 'A']);
    expect(readParams('check=a', 'check')).toEqual(['a']);
  });

  it('leaves out empty, valueless, broken and other names', () => {
    expect(readParams('?check=&check&checkz&check=+&check=%E0%A4%A&xcheck=1&checks=2&check=ok', 'check')).toEqual(['ok']);
    expect(readParams('?check=+a+&check=%20b%20', 'check')).toEqual(['a', 'b']);
    expect(readParams('', 'check')).toEqual([]);
  });
});

describe('readChecks (the hello screen, step 30c1)', () => {
  it('reads every check before the source, never one in the playlist URL', () => {
    const blocked = encodeURIComponent('http://u:p@cdn.blocked.test:8080/live/1.ts?a=1&b=2');
    expect(readChecks(`?screen=hello&check=${blocked}&check=http://ok.test/&source=${MOCK}&check=http://late.test/`)).toEqual([
      'http://u:p@cdn.blocked.test:8080/live/1.ts?a=1&b=2',
      'http://ok.test/',
    ]);
    expect(readChecks('?screen=hello')).toEqual([]);
  });
});

describe('readApiBase (?api=, step 30c1)', () => {
  const BUILD = 'http://127.0.0.1:3100';

  it("keeps the build's base without the parameter", () => {
    expect(readApiBase('', BUILD, true)).toBe(BUILD);
    expect(readApiBase('?screen=hello&q=x', BUILD, false)).toBe(BUILD);
  });

  it.each([
    'http://127.0.0.1:8090',
    'http://localhost:5400',
    'http://LOCALHOST',
    'https://127.0.0.1',
    'http://[::1]:9000',
  ])('takes the loopback origin %s in a TV build', (origin) => {
    expect(readApiBase(`?api=${encodeURIComponent(origin)}`, BUILD, false)).toBe(origin);
    expect(readApiBase(`?api=${origin}`, BUILD, false)).toBe(origin);
  });

  it('drops one trailing slash', () => {
    expect(readApiBase('?api=http://127.0.0.1:8090/', BUILD, false)).toBe('http://127.0.0.1:8090');
    expect(readApiBase('?api=http://127.0.0.1:8090//', BUILD, false)).toBe(BUILD);
  });

  it.each(['http://api.example.com', 'https://10.0.0.5:3100', 'http://127.0.0.2:8090', 'http://localhost.example.com', 'http://[::2]'])(
    'refuses %s in a TV build, takes it in the dev app',
    (origin) => {
      expect(readApiBase(`?api=${encodeURIComponent(origin)}`, BUILD, false)).toBe(BUILD);
      expect(readApiBase(`?api=${encodeURIComponent(origin)}`, BUILD, true)).toBe(origin);
    },
  );

  it.each([
    'ftp://127.0.0.1',
    'javascript:alert(1)',
    'http://127.0.0.1:8090/v1',
    'http://127.0.0.1:8090?x=1',
    'http://127.0.0.1:8090#x',
    'http://user@127.0.0.1:8090',
    'http://127.0.0.1:123456',
    'http://127.0.0.1:',
    '//127.0.0.1:8090',
    '127.0.0.1:8090',
    'http://',
    ' http://127.0.0.1 x',
    'xhttp://127.0.0.1:8090',
  ])('refuses %s anywhere: an origin only', (value) => {
    expect(readApiBase(`?api=${encodeURIComponent(value)}`, BUILD, true)).toBe(BUILD);
    expect(readApiBase(`?api=${encodeURIComponent(value)}`, BUILD, false)).toBe(BUILD);
  });

  it('takes the first api before the source, never one in the playlist URL', () => {
    expect(readApiBase('?api=http://127.0.0.1:1&api=http://127.0.0.1:2', BUILD, false)).toBe('http://127.0.0.1:1');
    expect(readApiBase(`?source=${MOCK}&api=http://127.0.0.1:1`, BUILD, false)).toBe(BUILD);
    expect(readApiBase(`?api=http://127.0.0.1:1&source=${MOCK}`, BUILD, false)).toBe('http://127.0.0.1:1');
    // A blank one is no value: the next one counts.
    expect(readApiBase('?api=&api=http://127.0.0.1:2', BUILD, false)).toBe('http://127.0.0.1:2');
  });
});

describe('the restart after "Restore it" (RELAY step 32d2b)', () => {
  it('puts restored=1 first in the query, once, and drops a fragment', () => {
    expect(restartUrl('file:///opt/app/index.html')).toBe('file:///opt/app/index.html?restored=1');
    expect(restartUrl('http://127.0.0.1:5173/?api=http://127.0.0.1:9&locale=ar-SA')).toBe('http://127.0.0.1:5173/?restored=1&api=http://127.0.0.1:9&locale=ar-SA');
    expect(restartUrl('http://127.0.0.1:5173/?restored=1&api=x')).toBe('http://127.0.0.1:5173/?restored=1&api=x');
    expect(restartUrl('http://127.0.0.1:5173/?restored=1')).toBe('http://127.0.0.1:5173/?restored=1');
    expect(restartUrl('http://127.0.0.1:5173/?')).toBe('http://127.0.0.1:5173/?restored=1');
    expect(restartUrl('http://127.0.0.1:5173/?device=d#top')).toBe('http://127.0.0.1:5173/?restored=1&device=d');
    // Before a source, which runs to the end of the address.
    expect(restartUrl('http://h/?screen=hello&source=http://p/get.php?a=1&b=2')).toBe('http://h/?restored=1&screen=hello&source=http://p/get.php?a=1&b=2');
  });

  it('reads the mark, and only its own value', () => {
    expect(readRestored('?restored=1&api=http://127.0.0.1:9')).toBe(true);
    expect(readRestored('?locale=ar-SA&restored=1')).toBe(true);
    expect(readRestored('')).toBe(false);
    expect(readRestored('?restored=0')).toBe(false);
    expect(readRestored('?restored=')).toBe(false);
    expect(readRestored('?xrestored=1')).toBe(false);
    // Inside a source's own query it is the source's.
    expect(readRestored('?source=http://p/a.m3u?restored=1')).toBe(false);
    expect(readRestored(new URL(restartUrl('http://h/?api=x')).search)).toBe(true);
  });
});
