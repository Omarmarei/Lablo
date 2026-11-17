import { describe, expect, it } from 'vitest';
import { normalizeLink as tvLink } from '../apps/tv/src/onboarding/form';
import { normalizeLink as phoneLink } from '../apps/web/src/phone/form';

/**
 * The phone page reads a link as the TV's own form does (RELAY step 31b): neither app may import
 * the other, so each has its own `normalizeLink`, and this holds them to the same answers.
 */
const SAMPLES = [
  '',
  '   ',
  'example.com',
  '  Example.COM:8080/Path?Q=A#F ',
  'HTTPS://Lists.Example/get.php?username=a&password=b',
  'http://1.2.3.4:80',
  'http://[::1]:8080/',
  'example.com?x=1',
  'example.com#x',
  'example.com/a b',
  'exa mple.com',
  'ftp://example.com',
  'rtmp://example.com/live',
  'httpx://example.com',
  'xhttp://example.com',
  'http://',
  'http:///path',
  'http://user:pass@example.com',
  'http://user@example.com',
  'http://example.com:123456',
  'http://example.com:',
  'http://:80',
  'HTTP://EXAMPLE.COM',
  'Https://a.example:443/x/Y?Z#W',
  'example.com:8080',
  'localhost',
  'a.example/ünïcode',
  'xn--mgbh0fb.example/x',
  'http://a.example/\u00a0x',
  'mailto:x@y.example',
  'javascript:alert(1)',
  '//example.com',
  'http:/example.com',
  'example.com/path//x?y=https://z',
  'http://a.example?b=c@d',
  'http://a.example#@b',
];

describe('the phone’s and the TV’s normalizeLink', () => {
  it.each(SAMPLES)('agree on %j', (typed) => {
    expect(phoneLink(typed)).toBe(tvLink(typed));
  });

  it('cover links each accepts and each refuses', () => {
    const answers = SAMPLES.map((typed) => tvLink(typed));
    expect(answers.filter((a) => a === null).length).toBeGreaterThan(5);
    expect(answers.filter((a) => a !== null).length).toBeGreaterThan(5);
  });
});
