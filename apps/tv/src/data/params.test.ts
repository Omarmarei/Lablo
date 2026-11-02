import { describe, expect, it } from 'vitest';
import { readDebugParams } from './params';

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
