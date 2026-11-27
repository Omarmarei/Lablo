import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TestServer } from './test-server';
import { startTestServer } from './test-server';
import { OPCODE } from './ws';

/**
 * `pnpm tv` as a process (RELAY step 58d), against a stand-in LG inspector that never answers a
 * WebSocket close, as `ares-inspect`'s tunnel does: each command prints its answer and ends. Before
 * the fix `eval`, `screen`, `marks` and `soak` did their work and never ended (leg 168).
 */
const ROOT = path.resolve(import.meta.dirname, '../../..');
const TSX = createRequire(import.meta.url).resolve('tsx/cli');
const TV = path.join(ROOT, 'tools/tv/tv.ts');
const APP = 'file:///media/developer/apps/usr/palm/applications/com.lablo.iptv/index.html';
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

interface Run {
  readonly code: number | null;
  readonly out: string;
  readonly ms: number;
}

/** Runs `pnpm tv <args>`; a run still going after `limitMs` is ended and reported with code null. */
function tv(args: readonly string[], limitMs = 25_000): Promise<Run> {
  const started = Date.now();
  const child = spawn(process.execPath, [TSX, TV, ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString()));
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill(), limitMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, out, ms: Date.now() - started });
    });
  });
}

describe('pnpm tv ends when its command is done, through a tunnel that never closes (step 58d)', () => {
  let server: TestServer | undefined;
  let dir: string | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function inspector(calls: string[]): Promise<TestServer> {
    return startTestServer({
      answerClose: false,
      http: (url, port) => (url === '/json' ? [{ type: 'page', id: 'P', url: APP, webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/P` }] : undefined),
      onFrame: (frame, peer) => {
        if (frame.opcode !== OPCODE.text) return;
        const request = JSON.parse(frame.payload.toString()) as { id: number; method: string; params: { expression?: string; windowsVirtualKeyCode?: number; type?: string } };
        calls.push(request.method === 'Input.dispatchKeyEvent' ? `${request.params.type} ${String(request.params.windowsVirtualKeyCode)}` : request.method);
        let result: unknown = {};
        if (request.method === 'Page.captureScreenshot') result = { data: PNG.toString('base64') };
        if (request.method === 'Runtime.evaluate') result = { result: { type: 'object', value: request.params.expression === '6 * 7' ? 42 : { focus: 'live/channels/1', text: 'Live TV' } } };
        peer.send(OPCODE.text, JSON.stringify({ id: request.id, result }));
      },
    });
  }

  it('eval prints the answer and ends, its socket never closed by the inspector', async () => {
    const calls: string[] = [];
    server = await inspector(calls);
    const run = await tv(['eval', '6 * 7', '--webos', '--port', String(server.port)]);
    expect(run.code).toBe(0);
    expect(run.out.trim()).toBe('42');
    expect(calls).toEqual(['Runtime.evaluate']);
    // The inspector never ended the socket: the process did.
    expect(server.peers[0]!.frames.map((f) => f.opcode)).toContain(OPCODE.close);
  });

  it('keys --webos presses each key in the app page, prints the screen and ends', async () => {
    const calls: string[] = [];
    server = await inspector(calls);
    const run = await tv(['keys', '--webos', 'DOWN', 'OK', '--port', String(server.port)]);
    expect(run.code).toBe(0);
    expect(calls).toEqual(['rawKeyDown 40', 'keyUp 40', 'rawKeyDown 13', 'keyUp 13', 'Runtime.evaluate']);
    expect(run.out.trim()).toBe('focus: live/channels/1\nLive TV');
  });

  it('shot --webos writes the PNG and ends; a bad key fails with a sentence and ends', async () => {
    const calls: string[] = [];
    server = await inspector(calls);
    dir = mkdtempSync(path.join(tmpdir(), 'lablo-tv-'));
    const file = path.join(dir, 'shots', 'screen.png');
    const run = await tv(['shot', file, '--webos', '--port', String(server.port)]);
    expect(run.code).toBe(0);
    expect(readFileSync(file)).toEqual(PNG);
    expect(run.out.trim()).toBe(`saved ${file} (8 bytes)`);
    const bad = await tv(['keys', '--webos', 'ENTER', '--port', String(server.port)]);
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/"ENTER" is not a key/);
  });
});
