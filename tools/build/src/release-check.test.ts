import { describe, expect, it } from 'vitest';
import {
  contentProblems,
  packageNameProblems,
  storePlaceholderProblems,
  trackedFileProblems,
  versionProblems,
} from './release-check';

const TIZEN = [
  '<widget version="{{version}}">',
  '<content src="index.html"/>',
  '<tizen:application id="abc.Lablo" package="abc" required_version="5.5"/>',
  '<tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>',
  '<tizen:privilege name="http://tizen.org/privilege/unlimitedstorage"/>',
  '</widget>',
].join('\n');
const WEBOS = JSON.stringify({ id: 'com.x', version: '{{version}}', main: 'index.html', type: 'web', disableBackHistoryAPI: true, requiredACG: [] });

describe('versionProblems', () => {
  it('is clean for a good version and templates', () => {
    expect(versionProblems('1.0.0', TIZEN, WEBOS)).toEqual([]);
  });
  it('rejects a malformed or 0.0.0 version', () => {
    expect(versionProblems('1.0', TIZEN, WEBOS)).toHaveLength(1);
    expect(versionProblems('0.0.0', TIZEN, WEBOS)).toEqual(['apps/tv version is 0.0.0']);
  });
  it('flags a template with a hard-coded version', () => {
    const hard = TIZEN.replace('{{version}}', '1.0.0');
    expect(versionProblems('1.2.3', hard, WEBOS).join('|')).toContain('platforms/tizen/config.xml has no {{version}}');
  });
  it('flags a Tizen manifest that installs below Tizen 5.5 (ADR-015)', () => {
    const old = TIZEN.replace('required_version="5.5"', 'required_version="4.0"');
    expect(versionProblems('1.0.0', old, WEBOS)).toEqual(['platforms/tizen/config.xml: required_version is "4.0", expected "5.5" (ADR-015)']);
  });
});

describe('storePlaceholderProblems', () => {
  it('names the file and placeholder', () => {
    const out = storePlaceholderProblems([
      { name: 'docs/store/a.md', text: 'visit <official domain>' },
      { name: 'docs/store/b.md', text: 'fine <lang>' },
    ]);
    expect(out).toEqual(['docs/store/a.md still has <official domain>']);
  });
  it('knows all four placeholders', () => {
    const text = '<official domain> <test server address> <tester username> <tester password>';
    expect(storePlaceholderProblems([{ name: 'n', text }])).toHaveLength(4);
  });
});

describe('trackedFileProblems', () => {
  it('flags keys, packages and env files, not the example', () => {
    const out = trackedFileProblems(['a/author.p12', 'dist/Lablo.wgt', 'apps/web/.env', 'apps/web/.env.local', 'apps/web/.env.example', 'src/x.ts']);
    expect(out).toHaveLength(4);
    expect(out.join('|')).not.toContain('.env.example');
  });
});

describe('contentProblems', () => {
  it('finds a private key, a token and a LAN address', () => {
    expect(contentProblems('k', '-----BEGIN RSA PRIVATE KEY-----')).toHaveLength(1);
    expect(contentProblems('t', 'ghp_' + 'a'.repeat(36))).toHaveLength(1);
    expect(contentProblems('l', 'http://10.50.231.153:8001')).toHaveLength(1);
    expect(contentProblems('s', 'LABLO_RATE_SECRET=abcdefghijklmnop')).toHaveLength(1);
  });
  it('passes plain text and an empty secret', () => {
    expect(contentProblems('ok', 'LABLO_RATE_SECRET= is set in Vercel; 127.0.0.1')).toEqual([]);
  });
});

describe('packageNameProblems', () => {
  it('wants the ipk of this version', () => {
    expect(packageNameProblems(['com.x_1.0.0_all.ipk'], 'com.x', '1.0.0')).toEqual([]);
    expect(packageNameProblems(['com.x_0.9.0_all.ipk'], 'com.x', '1.0.0')).toHaveLength(1);
  });
});
