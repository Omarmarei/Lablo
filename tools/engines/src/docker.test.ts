import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { imageTag } from './docker';

function context(dockerfile: string, script: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'zoma-docker-'));
  writeFileSync(path.join(dir, 'Dockerfile'), dockerfile);
  writeFileSync(path.join(dir, 'run-chrome.sh'), script);
  return dir;
}

describe('imageTag', () => {
  it('is the same for LF and CRLF checkouts, so Windows and CI share one tag', () => {
    const lf = imageTag(context('FROM debian\nRUN true\n', '#!/bin/sh\nexec chrome\n'));
    const crlf = imageTag(context('FROM debian\r\nRUN true\r\n', '#!/bin/sh\r\nexec chrome\r\n'));
    expect(lf).toMatch(/^zoma-old-engines:[0-9a-f]{12}$/);
    expect(crlf).toBe(lf);
  });

  it('changes when the Dockerfile or the start script changes', () => {
    const base = imageTag(context('FROM debian\n', 'exec chrome\n'));
    expect(imageTag(context('FROM debian:stretch\n', 'exec chrome\n'))).not.toBe(base);
    expect(imageTag(context('FROM debian\n', 'exec chrome --flag\n'))).not.toBe(base);
  });
});
