import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IMAGE_FILES, imageTag } from './docker';

function context(dockerfile: string, script: string, server = 'echo 1\n'): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'zoma-docker-'));
  writeFileSync(path.join(dir, 'Dockerfile'), dockerfile);
  writeFileSync(path.join(dir, 'run-chrome.sh'), script);
  writeFileSync(path.join(dir, 'serve-fixture.sh'), server);
  return dir;
}

describe('imageTag', () => {
  it('is the same for LF and CRLF checkouts, so Windows and CI share one tag', () => {
    const lf = imageTag(context('FROM debian\nRUN true\n', '#!/bin/sh\nexec chrome\n', 'a = 1\nb = 2\n'));
    const crlf = imageTag(context('FROM debian\r\nRUN true\r\n', '#!/bin/sh\r\nexec chrome\r\n', 'a = 1\r\nb = 2\r\n'));
    expect(lf).toMatch(/^zoma-old-engines:[0-9a-f]{12}$/);
    expect(crlf).toBe(lf);
  });

  it('changes when the Dockerfile, the start script or the fixture server changes', () => {
    const base = imageTag(context('FROM debian\n', 'exec chrome\n'));
    expect(imageTag(context('FROM debian:stretch\n', 'exec chrome\n'))).not.toBe(base);
    expect(imageTag(context('FROM debian\n', 'exec chrome --flag\n'))).not.toBe(base);
    expect(imageTag(context('FROM debian\n', 'exec chrome\n', 'echo 2\n'))).not.toBe(base);
  });

  it('hashes every file the real Dockerfile copies into the image', () => {
    const dir = path.join(import.meta.dirname, '..', 'docker');
    const dockerfile = readFileSync(path.join(dir, 'Dockerfile'), 'utf8');
    const copied = [...dockerfile.matchAll(/^COPY (.+) \S+$/gm)].flatMap((m) => (m[1] ?? '').split(/\s+/));
    expect(copied.length).toBeGreaterThan(0);
    for (const name of copied) expect(IMAGE_FILES).toContain(name);
    for (const name of IMAGE_FILES) expect(existsSync(path.join(dir, name))).toBe(true);
  });
});
