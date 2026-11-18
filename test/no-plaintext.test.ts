import { describe, expect, it } from 'vitest';
import { newBoxKeyPair, newFileKey, newFileNonceBase, sealFile, sealPairPayload, toBase64Url, utf8 } from '@lablo/crypto';
import { leaks, needleForms } from '../e2e/no-plaintext';

/** RELAY step 31e: the search for a source's secrets in what the web app received or keeps. */

const BACKSLASH = String.fromCharCode(92);
/** An Arabic name (lam, alef, beh, lam, waw), written by code point. */
const ARABIC = String.fromCharCode(0x644, 0x627, 0x628, 0x644, 0x648);
const LINK = 'http://127.0.0.1:61234/get.php?username=lablo&password=lablo-test';

describe('needleForms', () => {
  it('is the needle alone when nothing in it needs escaping', () => {
    expect(needleForms('lablo-test')).toEqual(['lablo-test']);
  });

  it('adds the JSON, escaped and percent-encoded forms, each once', () => {
    const forms = needleForms(`a/${ARABIC} b`);
    expect(forms[0]).toBe(`a/${ARABIC} b`);
    expect(forms).toContain(`a${BACKSLASH}/${ARABIC} b`);
    expect(forms).toContain(`a/${BACKSLASH}u0644${BACKSLASH}u0627${BACKSLASH}u0628${BACKSLASH}u0644${BACKSLASH}u0648 b`);
    expect(forms).toContain(`a${BACKSLASH}/${BACKSLASH}u0644${BACKSLASH}u0627${BACKSLASH}u0628${BACKSLASH}u0644${BACKSLASH}u0648 b`);
    expect(forms).toContain(encodeURIComponent(`a/${ARABIC} b`));
    expect(forms).toContain(encodeURIComponent(`a/${ARABIC} b`).split('%20').join('+'));
    expect(forms).toContain(encodeURI(`a/${ARABIC} b`));
    expect(new Set(forms).size).toBe(forms.length);
    // Upper-case hex: an Arabic letter has hex letters only past 0x6xx (yeh, 0x64a).
    expect(needleForms(String.fromCharCode(0x64a))).toContain(`${BACKSLASH}u064A`);
    // A quote and a backslash, as JSON writes them.
    expect(needleForms('say "hi"')).toContain(`say ${BACKSLASH}"hi${BACKSLASH}"`);
  });
});

describe('leaks', () => {
  const needles = ['127.0.0.1:61234', 'lablo-test', LINK, ARABIC, 'absent-needle'];

  it('finds a needle as it is, in text and in bytes, in the order given', () => {
    expect(leaks(`{"server":"http://127.0.0.1:61234","password":"lablo-test","name":"${ARABIC}"}`, needles)).toEqual(['127.0.0.1:61234', 'lablo-test', ARABIC]);
    expect(leaks(Buffer.from(`x${ARABIC}y`, 'utf8'), needles)).toEqual([ARABIC]);
    expect(leaks(new Uint8Array(Buffer.from(`--${LINK}--`)).subarray(2, 2 + LINK.length), needles)).toEqual(['127.0.0.1:61234', 'lablo-test', LINK]);
  });

  it('finds it JSON-escaped: slashes and non-ASCII characters, each escaped alone or both', () => {
    // Non-ASCII escaped, the slash as it is (as an ASCII-only JSON writer that leaves `/` alone).
    // (Yeh, 0x64a: its hex has a letter, so the lower-case escape is a form of its own.)
    expect(leaks(`"${BACKSLASH}u0644${BACKSLASH}u064a/x"`, [`${String.fromCharCode(0x644, 0x64a)}/x`])).toHaveLength(1);
    expect(leaks(LINK.split('/').join(`${BACKSLASH}/`), [LINK])).toEqual([LINK]);
    expect(leaks(`"${BACKSLASH}u0644${BACKSLASH}u0627${BACKSLASH}u0628${BACKSLASH}u0644${BACKSLASH}u0648"`, [ARABIC])).toEqual([ARABIC]);
  });

  it('finds it percent-encoded, as a component, a URI or a form', () => {
    expect(leaks(`/x?u=${encodeURIComponent(LINK)}`, [LINK])).toEqual([LINK]);
    // As a URI the slash stays: only that form has it.
    expect(leaks(`/p/${encodeURI(`${ARABIC} x/y`)}`, [`${ARABIC} x/y`])).toEqual([`${ARABIC} x/y`]);
    expect(leaks('name=Living+room+secret', ['Living room secret'])).toEqual(['Living room secret']);
  });

  it('finds it inside base64 and base64url runs, decoded', () => {
    // A first byte of 0xfb encodes as `+` (`-` in base64url): only the run pattern of the token's
    // own alphabet starts at its first character, so only it decodes the token in step.
    const bytes = Buffer.concat([Buffer.from([0xfb]), Buffer.from(JSON.stringify({ source: { url: LINK }, name: ARABIC }))]);
    const url = toBase64Url(new Uint8Array(bytes));
    const standard = bytes.toString('base64');
    expect(url.charAt(0)).toBe('-');
    expect(standard.charAt(0)).toBe('+');
    expect(leaks(`{"ct":"${url}"}`, needles)).toEqual(['127.0.0.1:61234', 'lablo-test', LINK, ARABIC]);
    expect(leaks(`ct=${standard}`, needles)).toEqual(['127.0.0.1:61234', 'lablo-test', LINK, ARABIC]);
  });

  it('never matches an empty needle', () => {
    expect(needleForms('')).toEqual([]);
    expect(leaks('anything at all', [''])).toEqual([]);
  });

  it('finds nothing in a sealed payload, nor in a sealed file', () => {
    const tv = newBoxKeyPair();
    const payload = { v: 1, source: { type: 'xtream', server: 'http://127.0.0.1:61234', username: 'lablo', password: 'lablo-test' }, name: ARABIC };
    const sealed = sealPairPayload(utf8(JSON.stringify(payload)), tv.publicKey);
    expect(leaks(JSON.stringify(sealed), [...needles, 'lablo', 'xtream'])).toEqual([]);
    const plain = utf8(`#EXTM3U\n#EXTINF:-1,${ARABIC}\n${LINK}\n`);
    expect(leaks(plain, ['#EXTINF', ARABIC, LINK])).toEqual(['#EXTINF', ARABIC, LINK]);
    expect(leaks(sealFile(plain, newFileKey(), newFileNonceBase()), ['#EXTM3U', '#EXTINF', ARABIC, LINK])).toEqual([]);
  });
});
