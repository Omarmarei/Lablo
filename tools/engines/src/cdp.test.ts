import { describe, expect, it } from 'vitest';
import { pageSocketUrl } from './cdp';

describe('pageSocketUrl', () => {
  it('points the page target at the published host port', () => {
    const targets = [
      { type: 'background_page', url: 'chrome-extension://x', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/BG' },
      { type: 'page', url: 'about:blank', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/4f1c-77' },
    ];
    expect(pageSocketUrl(targets, 49153)).toBe('ws://127.0.0.1:49153/devtools/page/4f1c-77');
  });

  it('also rewrites engines that echo the Host header back', () => {
    const targets = [{ type: 'page', url: 'about:blank', webSocketDebuggerUrl: 'ws://localhost:9223/devtools/page/A' }];
    expect(pageSocketUrl(targets, 50000)).toBe('ws://127.0.0.1:50000/devtools/page/A');
  });

  it('fails when there is no page to drive (e.g. another client attached)', () => {
    expect(() => pageSocketUrl([{ type: 'page', url: 'about:blank' }], 1)).toThrow(/no page target/);
    expect(() => pageSocketUrl([], 1)).toThrow(/no page target/);
  });
});
