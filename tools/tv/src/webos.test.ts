import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TestServer } from './test-server';
import { startTestServer } from './test-server';
import { aresInspectArgs, forwardInspector, parseAresInspect, SCREENSHOT, screenshotBytes, waitForAresInspect, WEBOS_KEY_CODES, WEBOS_KEY_GAP_MS, WEBOS_PORT, webosAppId, webosKeySteps, webosPage } from './webos';
import { OPCODE } from './ws';

/**
 * `pnpm tv` on webOS (RELAY step 56), with no TV: a stand-in ares-inspect (a Node child process
 * that prints what the real one prints, then stays up as the real one does while it holds the
 * tunnel) and a local inspector (`startTestServer`) listing the TV runtime's pages.
 */

const APP = 'com.lablo.iptv';
const ROOT = path.resolve(import.meta.dirname, '../../..');
const children: ChildProcess[] = [];

/** A stand-in ares-inspect: `script` runs in a Node child, with its arguments after it. */
function fakeAres(script: string, args: string[] = []): ChildProcess {
  const child = spawn(process.execPath, ['-e', script, '--', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  return child;
}

/** Prints `lines` (each after `gap` ms), then stays up. */
function printsThenHolds(lines: string[], gap = 20): string {
  return `const lines = ${JSON.stringify(lines)}; let i = 0; const next = () => { if (i < lines.length) { process.stdout.write(lines[i++]); setTimeout(next, ${gap}); } }; next(); setInterval(() => undefined, 1000);`;
}

function exited(child: ChildProcess): Promise<void> {
  return child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise((resolve) => child.once('exit', () => resolve()));
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill();
    await exited(child);
  }
});

describe('ares-inspect arguments and output', () => {
  it('asks for the app on the device, forwarded to the port here, with no browser', () => {
    expect(aresInspectArgs('tv', APP, 9998)).toEqual(['--device', 'tv', '--app', APP, '--host-port', '9998']);
    expect(aresInspectArgs('tv', APP, 9998)).not.toContain('--open');
    expect(WEBOS_PORT).toBe(9998);
  });

  it('reads the forwarded port from its line, the DevTools path after it or not', () => {
    expect(parseAresInspect('Application Debugging - http://localhost:9998\n')).toBe(9998);
    expect(parseAresInspect('⠋ \nApplication Debugging - http://localhost:51234/devtools/inspector.html?ws=localhost:51234/devtools/page/AB12\n')).toBe(51_234);
    expect(parseAresInspect('Application Debugging - http://127.0.0.1:65535')).toBe(65_535);
    expect(parseAresInspect('Application Debugging - https://localhost:1')).toBe(1);
  });

  it('gives null for no line, no usable port, or a host that is not this PC (no forwarding)', () => {
    expect(parseAresInspect('')).toBeNull();
    expect(parseAresInspect('ares-inspect ERR! [Tips]: Failed to connect to the device')).toBeNull();
    expect(parseAresInspect('Application Debugging - http://localhost:0')).toBeNull();
    expect(parseAresInspect('Application Debugging - http://localhost:70000')).toBeNull();
    expect(parseAresInspect('Application Debugging - http://192.168.1.8:9998')).toBeNull();
    expect(parseAresInspect('Application Debugging - http://localhost')).toBeNull();
    expect(parseAresInspect('Service Debugging - http://localhost:9229')).toBeNull();
  });

  it("reads the app's id from its appinfo.json: the app's and the lab's differ", () => {
    expect(webosAppId(readFileSync(path.join(ROOT, 'platforms/webos/appinfo.json'), 'utf8'))).toBe(APP);
    expect(webosAppId('{"id":"com.lablo.iptv.lab","version":"0.1.2"}')).toBe('com.lablo.iptv.lab');
    for (const text of ['', 'not json', 'null', '[]', '{}', '{"id":""}', '{"id":7}']) expect(webosAppId(text)).toBeNull();
  });

  it("looks for the app's own folder in a page's URL, so the lab's never matches the app", () => {
    expect(webosPage(APP)).toBe('/com.lablo.iptv/');
    expect('file:///media/developer/apps/usr/palm/applications/com.lablo.iptv.lab/index.html'.includes(webosPage(APP))).toBe(false);
    expect('file:///media/developer/apps/usr/palm/applications/com.lablo.iptv/index.html'.includes(webosPage(APP))).toBe(true);
  });
});

describe('waitForAresInspect (a stand-in ares-inspect)', () => {
  it('resolves with the port once the line is out, split over writes, and leaves it running', async () => {
    const child = fakeAres(printsThenHolds(['⠋ launching', '\nApplication Debugging - http://local', 'host:43210/devtools/inspector.html\n']));
    expect(await waitForAresInspect(child, 10_000)).toBe(43_210);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(child.exitCode).toBeNull();
    expect([child.listenerCount('exit'), child.listenerCount('error'), child.stdout?.listenerCount('data'), child.stderr?.listenerCount('data')]).toEqual([0, 0, 0, 0]);
  });

  it('reads the line from stderr too', async () => {
    const child = fakeAres('process.stderr.write("Application Debugging - http://localhost:40001\\n"); setInterval(() => undefined, 1000);');
    expect(await waitForAresInspect(child, 10_000)).toBe(40_001);
  });

  it('rejects with what it printed when it ends first', async () => {
    const child = fakeAres('process.stderr.write("ares-inspect ERR! [Tips]: Failed to get device info\\n"); process.exit(1);');
    await expect(waitForAresInspect(child, 10_000)).rejects.toThrow('ares-inspect ended (exit 1) before it forwarded a port:\nares-inspect ERR! [Tips]: Failed to get device info');
  });

  it('ends it and rejects when no port comes in time', async () => {
    const child = fakeAres(printsThenHolds(['⠋ launching']));
    await expect(waitForAresInspect(child, 400)).rejects.toThrow('ares-inspect forwarded no port within 400 ms:\n⠋ launching');
    await exited(child);
    expect(child.killed).toBe(true);
  });

  it('rejects when it cannot start', async () => {
    const child = spawn(path.join(ROOT, 'no-such-ares-inspect.exe'), [], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    await expect(waitForAresInspect(child, 10_000)).rejects.toThrow(/^ares-inspect failed to start: /);
  });
});

describe('forwardInspector (a stand-in ares-inspect and a local inspector)', () => {
  let server: TestServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  /** The TV runtime's inspector: its own app's page first, then the lab's and the app's (each `with` the given pages). */
  function runtime(pages: string[]): Promise<TestServer> {
    return startTestServer({
      http: (requested, port) =>
        requested === '/json'
          ? pages.map((id) => ({ type: 'page', id, url: `file:///media/developer/apps/usr/palm/applications/${id}/index.html`, webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${id}` }))
          : undefined,
      onFrame: (frame, peer) => {
        if (frame.opcode !== OPCODE.text) return;
        const request = JSON.parse(frame.payload.toString()) as { id: number; params: { expression: string } };
        peer.send(OPCODE.text, JSON.stringify({ id: request.id, result: { result: { value: `${peer.path} ${request.params.expression}` } } }));
      },
    });
  }

  it("starts ares-inspect with the app's arguments, waits for its port, and reads the app's page there", async () => {
    server = await runtime(['com.webos.app.home', 'com.lablo.iptv.lab', APP]);
    const asked: string[][] = [];
    let child: ChildProcess | undefined;
    const result = await forwardInspector(
      (args) => {
        asked.push(args);
        child = fakeAres(printsThenHolds([`Application Debugging - http://localhost:${server!.port}\n`]), args);
        return child;
      },
      'tv',
      APP,
      9998,
      10_000,
    );
    expect(asked).toEqual([['--device', 'tv', '--app', APP, '--host-port', '9998']]);
    expect(result.port).toBe(server.port);
    expect(result.href).toBe(`/devtools/page/${APP} location.href`);
    expect(result.child).toBe(child);
    expect(child?.exitCode).toBeNull();
    expect(server.peers.map((peer) => peer.path)).toEqual([`/devtools/page/${APP}`]);
  });

  it("ends ares-inspect and names the pages when the app's page is not there", async () => {
    server = await runtime(['com.webos.app.home', 'com.lablo.iptv.lab']);
    let child: ChildProcess | undefined;
    const port = server.port;
    await expect(
      forwardInspector(
        (args) => {
          child = fakeAres(printsThenHolds([`Application Debugging - http://localhost:${port}\n`]), args);
          return child;
        },
        'tv',
        APP,
        9998,
        10_000,
      ),
    ).rejects.toThrow(
      `no page of /com.lablo.iptv/ on the inspector at port ${port} (is the app running?); it lists: file:///media/developer/apps/usr/palm/applications/com.webos.app.home/index.html, file:///media/developer/apps/usr/palm/applications/com.lablo.iptv.lab/index.html`,
    );
    await exited(child!);
    expect(child!.killed).toBe(true);
  });

  it('passes on what ares-inspect said when it fails', async () => {
    await expect(forwardInspector(() => fakeAres('console.error("ares-inspect ERR! [Tips]: Invalid device name"); process.exit(2);'), 'tw', APP, 9998, 10_000)).rejects.toThrow(
      'ares-inspect ended (exit 2) before it forwarded a port:\nares-inspect ERR! [Tips]: Invalid device name',
    );
  });
});

describe('keys and shot on the LG (step 58d)', () => {
  const press = (code: number) => [
    { method: 'Input.dispatchKeyEvent', params: { type: 'rawKeyDown', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code } },
    { method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code } },
  ];

  it('presses and releases each key with a pause after it; a number is a further pause', () => {
    expect(webosKeySteps(['DOWN', 'OK', '1200', 'BACK'])).toEqual([
      ...press(40),
      { pause: WEBOS_KEY_GAP_MS },
      ...press(13),
      { pause: WEBOS_KEY_GAP_MS },
      { pause: 1200 },
      ...press(461),
      { pause: WEBOS_KEY_GAP_MS },
    ]);
    expect(WEBOS_KEY_GAP_MS).toBe(450);
  });

  it("sends the LG remote's codes", () => {
    expect([WEBOS_KEY_CODES.UP, WEBOS_KEY_CODES.LEFT, WEBOS_KEY_CODES.RIGHT, WEBOS_KEY_CODES.CH_UP, WEBOS_KEY_CODES.RED, WEBOS_KEY_CODES.BLUE, WEBOS_KEY_CODES.INFO]).toEqual([38, 37, 39, 33, 403, 406, 457]);
    expect([WEBOS_KEY_CODES.DIGIT_0, WEBOS_KEY_CODES.DIGIT_9, WEBOS_KEY_CODES.PLAY, WEBOS_KEY_CODES.PAUSE]).toEqual([48, 57, 415, 19]);
  });

  it('says what is wrong: no keys, an unknown name, a pause that is not a whole number', () => {
    expect(webosKeySteps([])).toMatch(/^Usage: pnpm tv keys --webos <key\|ms>\.\.\. \(keys: UP DOWN LEFT RIGHT OK BACK /);
    expect(webosKeySteps(['OK', 'ENTER'])).toMatch(/^"ENTER" is not a key \(UP DOWN .*\) or a pause in ms$/);
    expect(webosKeySteps(['-5'])).toMatch(/^"-5" is not a key/);
    expect(webosKeySteps(['1.5'])).toMatch(/^"1.5" is not a key/);
    expect(webosKeySteps(['1234567'])).toMatch(/^"1234567" is not a key/);
    expect(webosKeySteps(['up'])).toMatch(/^"up" is not a key/);
  });

  it('asks for a PNG and reads its bytes', () => {
    expect(SCREENSHOT).toEqual({ method: 'Page.captureScreenshot', params: { format: 'png' } });
    expect(screenshotBytes({ data: Buffer.from('PNG!').toString('base64') })?.toString()).toBe('PNG!');
    expect([screenshotBytes({ data: '' }), screenshotBytes({}), screenshotBytes(null), screenshotBytes({ data: 3 })]).toEqual([null, null, null, null]);
  });
});
