import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isTld, KNOWN_MIN_CHARS, SCRUB_INPUT_MAX_CHARS, SCRUB_MAX_CHARS, scrubText, TLDS } from './scrub';

/**
 * The telemetry scrubber (RELAY step 33a, architecture.md §3.4): what each rule takes out and
 * keeps, on text shaped like the TVs' own errors and stacks, then properties over random text.
 */

const WEBOS_FRAME = 'file:///media/developer/apps/usr/palm/applications/com.lablo.iptv/main.js';
const TIZEN_FRAME = 'file:///opt/usr/apps/LabloIPTV1/res/wgt/main.js';
const WORKER_UUID = '6e1b2f3a-9c4d-4e5f-8a7b-0c1d2e3f4a5b';

describe('scrubText', () => {
  it("keeps the app's own script frames as their file and position (Chromium 53 and 68 stacks)", () => {
    const stack = [
      "TypeError: Cannot read property 'length' of undefined",
      `    at e.render (${WEBOS_FRAME}:1:23456)`,
      `    at Object.n [as next] (${TIZEN_FRAME}:2:345)`,
      `    at self.onmessage (blob:file:///${WORKER_UUID}:1:9876)`,
      `    at r (blob:null/${WORKER_UUID}:1:12)`,
      `    at ${TIZEN_FRAME}:7:8`,
    ].join('\n');
    expect(scrubText(stack)).toBe(
      [
        "TypeError: Cannot read property 'length' of undefined",
        '    at e.render (main.js:1:23456)',
        '    at Object.n [as next] (main.js:2:345)',
        '    at self.onmessage (worker:1:9876)',
        '    at r (worker:1:12)',
        '    at main.js:7:8',
      ].join('\n'),
    );
  });

  it('takes out every other URL whole: a panel with its login, an M3U link with a token, a stream, any scheme', () => {
    expect(scrubText('GET http://panel.example.com:8080/player_api.php?username=marker-user&password=marker-pass failed')).toBe('GET [url] failed');
    expect(scrubText('fetch(https://cdn.example.net/list.m3u?token=abc123) rejected')).toBe('fetch([url]) rejected');
    expect(scrubText('src="http://1.2.3.4:25461/live/u/p/101.ts"')).toBe('src="[url]"');
    // A comma right after a URL goes with it (a URL may hold one).
    expect(scrubText('rtmp://media.example/live/x, udp://@239.0.0.1:1234 and HTTP://UPPER.example/A')).toBe('[url] [url] and [url]');
    expect(scrubText('a file that is no script: file:///opt/usr/apps/x/res/wgt/index.html?x=1')).toBe('a file that is no script: [url]');
    expect(scrubText('a blob that is no frame: blob:https://example.com/abc')).toBe('a blob that is no frame: [url]');
    // A URL ends at a space, a quote, a bracket or a parenthesis.
    expect(scrubText("x 'http://a.example/p' y <http://b.example/q> [http://c.example/r] {http://d.example/s}")).toBe("x '[url]' y <[url]> [[url]] {[url]}");
  });

  it("takes out the TV's own logins, links and hosts exactly, longest first, from a length of four", () => {
    const known = ['marker-pass', 'marker-pass-longer', 'panel.example', 'abc', ''];
    expect(scrubText('login marker-pass-longer then marker-pass at panel.example.org, abc stays', known)).toBe(
      'login [login] then [login] at [login].org, abc stays',
    );
    expect(KNOWN_MIN_CHARS).toBe(4);
    expect(scrubText('word wxyz and wxy', ['wxyz', 'wxy'])).toBe('word [login] and wxy');
    // Inside a word too, and anything that isn't a string is skipped.
    expect(scrubText('xxmarker-userxx', ['marker-user', 42 as unknown as string, null as unknown as string])).toBe('xx[login]xx');
    // A URL goes whole before the known strings run: no part of it is left around one.
    expect(scrubText('see http://panel.example/get.php?u=1 now', ['panel.example'])).toBe('see [url] now');
  });

  it('keeps the key of a credential pair and drops its value, in query and JSON form', () => {
    expect(scrubText('username=marker-user&password=marker-pass&type=m3u_plus')).toBe('username=[x]&password=[x]&type=m3u_plus');
    expect(scrubText('?user=a;pass=b, token=c) Token=D key=e sid=f')).toBe('?user=[x];pass=[x], token=[x]) Token=[x] key=[x] sid=[x]');
    expect(scrubText('monkey=1 inside=2 passport=3')).toBe('monkey=1 inside=2 passport=3');
    const keys = ['user', 'username', 'uname', 'login', 'pass', 'passwd', 'password', 'pwd', 'token', 'auth', 'apikey', 'api_key', 'key', 'secret', 'session', 'sessionid', 'sid', 'sig', 'signature'];
    for (const key of keys) {
      expect(scrubText(`${key}=v1 ${key.toUpperCase()}=v2`)).toBe(`${key}=[x] ${key.toUpperCase()}=[x]`);
      expect(scrubText(`{"${key}":"v"}`)).toBe(`{"${key}":"[x]"}`);
    }
    expect(scrubText('{"username":"marker-user","password" : "mark\\"er","name":"x"}')).toBe('{"username":"[x]","password" : "[x]","name":"x"}');
  });

  it('takes the login out of an Xtream path without its URL', () => {
    expect(scrubText('no route /live/marker-user/marker-pass/101.ts')).toBe('no route /live/[x]/[x]/101.ts');
    expect(scrubText('/movie/u/p/7.mkv /series/u/p/8.mp4 /timeshift/u/p/60/2026-11-19:10-00/9.ts /Live/u/p/1')).toBe(
      '/movie/[x]/[x]/7.mkv /series/[x]/[x]/8.mp4 /timeshift/[x]/[x]/60/2026-11-19:10-00/9.ts /Live/[x]/[x]/1',
    );
    expect(scrubText('/live/only-one')).toBe('/live/only-one');
  });

  it('takes out e-mail addresses, IP addresses and hosts', () => {
    expect(scrubText('mail me@example.com or first.last+tv@mail.example.co.uk')).toBe('mail [email] or [email]');
    expect(scrubText('at 192.168.1.8:8080 and 10.0.0.1')).toBe('at [ip] and [ip]');
    expect(scrubText('v6 2001:db8:85a3:0:0:8a2e:370:7334 and fe80::1%eth0 and [::1]:8080 and ::ffff:1.2.3.4')).toBe('v6 [ip] and [ip] and [ip] and [ip][ip]');
    expect(scrubText('full 2001:db8:85a3:0:0:8a2e:370:abcd here')).toBe('full [ip] here');
    expect(scrubText('host panel.example.com, line.tvhost.xyz, my-iptv.tv, Panel.Example.NET')).toBe('host [host], [host], [host], [host]');
  });

  it('leaves what has none of those shapes: clock times, versions, script names, file types, words', () => {
    const plain = 'at 10:30:00 version 1.2.3 in main.js and app.css, index.html; 101.ts plays; e.g. it works: 3 of 4; item.tv2 and box.de-x';
    expect(scrubText(plain)).toBe(plain);
    expect(scrubText('a.b c.de')).toBe('a.b [host]');
  });

  it('counts the common generic domains and every two-letter label but js as top-level', () => {
    for (const tld of ['com', 'NET', 'xyz', 'tv', 'Me', 'sa', 'ae', 'qq']) expect([tld, isTld(tld)]).toEqual([tld, true]);
    for (const tld of ['js', 'JS', 'css', 'html', 'value', 'x', '']) expect([tld, isTld(tld)]).toEqual([tld, false]);
    expect(new Set(TLDS).size).toBe(TLDS.length);
    for (const tld of TLDS) expect(tld).toMatch(/^[a-z]{3,24}$/);
  });

  it('cuts its answer to the stack’s length, and a longer input first, dropping the token at that cut', () => {
    expect(SCRUB_MAX_CHARS).toBe(4000);
    expect(scrubText('a'.repeat(5000))).toBe('a'.repeat(SCRUB_MAX_CHARS));
    // A login cut in two at the input's cut leaves neither half.
    const input = '[url] '.repeat(1) + 'x '.repeat((SCRUB_INPUT_MAX_CHARS - 10) / 2) + 'marker-pass-cut-here';
    expect(input.length).toBeGreaterThan(SCRUB_INPUT_MAX_CHARS);
    const out = scrubText(input, ['marker-pass-cut-here']);
    expect(out).not.toContain('marker');
    // Long URLs shrink to a token: what's left of a long stack fits.
    const urls = `${'http://h.example/' + 'p'.repeat(200)} `.repeat(70);
    expect(urls.length).toBeGreaterThan(SCRUB_INPUT_MAX_CHARS - 2000);
    expect(scrubText(urls)).toBe('[url] '.repeat(Math.min(70, Math.floor(SCRUB_INPUT_MAX_CHARS / 218))));
  });

  it('drops the token at the input’s cut even where what comes before shrinks under the answer’s cap', () => {
    expect(SCRUB_INPUT_MAX_CHARS).toBe(16000);
    const unit = `http://h.example/${'p'.repeat(200)} `;
    const head = unit.repeat(73) + 'y'.repeat(80) + ' ';
    expect(head.length).toBe(SCRUB_INPUT_MAX_CHARS - 5);
    // The input's cut falls inside the login: 'marke' would be left.
    expect(scrubText(head + 'marker-pass-cut-here', ['marker-pass-cut-here'])).toBe('[url] '.repeat(73) + 'y'.repeat(80) + ' ');
    // At exactly the input's length nothing is cut: the last token stays.
    expect(scrubText(head + 'tail', [])).toBe('[url] '.repeat(73) + 'y'.repeat(80) + ' tail');
    expect((head + 'tail').length).toBe(SCRUB_INPUT_MAX_CHARS - 1);
    expect(scrubText(head + 'tail5', [])).toBe('[url] '.repeat(73) + 'y'.repeat(80) + ' tail5');
  });

  it('reads anything as text', () => {
    expect(scrubText(12 as unknown as string)).toBe('12');
    expect(scrubText(undefined as unknown as string)).toBe('undefined');
  });

  it('imports nothing (its entry point is for workers that take no zod)', () => {
    const source = readFileSync(join(import.meta.dirname, 'scrub.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/new RegExp\(/);
  });
});

/** Text with none of the scrubber's shapes: no `:`, `.`, `/`, `@`, `=` or `"`. */
const plainChar = fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 \n\t-_,;()[]{}<>\'!?#%&*+'.split(''));
const plainText = fc.string({ unit: plainChar, maxLength: 120 });
/** A secret that our tokens can't spell: lower-case letters and digits, with a digit in it. */
const secret = fc
  .tuple(fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), minLength: 6, maxLength: 16 }), fc.integer({ min: 0, max: 9 }))
  .map(([s, d]) => `${s}${d}`);
const label = fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), minLength: 1, maxLength: 10 }).filter((s) => /[a-z]/.test(s));

describe('scrubText over random text', () => {
  it('gives text with none of its shapes back unchanged', () => {
    fc.assert(fc.property(plainText, (text) => scrubText(text) === text));
  });

  it('never lets a URL’s secret through, wherever the URL sits', () => {
    fc.assert(
      fc.property(plainText, plainText, secret, fc.constantFrom('http', 'https', 'rtmp', 'rtsp'), (before, after, s, scheme) => {
        const out = scrubText(`${before}${scheme}://h.example:8080/live/${s}/x/1.ts${after}`);
        return !out.includes(s);
      }),
    );
  });

  it('never lets a known string through', () => {
    fc.assert(fc.property(plainText, plainText, secret, (before, after, s) => !scrubText(`${before}${s}${after}`, [s]).includes(s)));
  });

  it('never lets an IPv4 address or a host through', () => {
    const octet = fc.integer({ min: 0, max: 255 });
    fc.assert(
      fc.property(plainText, plainText, octet, octet, octet, octet, (before, after, a, b, c, d) => {
        const ip = `${a}.${b}.${c}.${d}`;
        return !scrubText(`${before} ${ip} ${after}`).includes(ip);
      }),
    );
    fc.assert(
      fc.property(plainText, plainText, label, label, fc.constantFrom('com', 'net', 'xyz', 'tv', 'sa'), (before, after, x, y, tld) => {
        const host = `${x}.${y}.${tld}`;
        return !scrubText(`${before} ${host} ${after}`).includes(host);
      }),
    );
  });

  it('never lets a password pair’s value through', () => {
    fc.assert(fc.property(plainText, secret, (before, s) => !scrubText(`${before} password=${s}&x=1`).includes(s)));
  });

  it('scrubs its own answer to the same text', () => {
    const any = fc.string({ maxLength: 200 });
    fc.assert(fc.property(any, (text) => scrubText(scrubText(text)) === scrubText(text)));
  });

  it('never answers more than its cap', () => {
    fc.assert(fc.property(fc.string({ maxLength: 6000 }), (text) => scrubText(text).length <= SCRUB_MAX_CHARS));
  });
});
