import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG_FILES } from '../src/cli';
import { devPublicKey, parseKeys, verifyConfig } from '../src/config';

/**
 * The committed config (RELAY step 30a): `config/config.signed.json` must be `config/config.json`
 * signed by a trusted key (the dev key until step 34's key ceremony, a production key after),
 * so an edit that wasn't signed again fails here. Its date isn't checked (`pnpm sign-config
 * verify` does that), so this test can't start failing on a calendar day.
 */

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

describe('the committed config', () => {
  it('is config.json signed by a trusted key', () => {
    const keys = parseKeys(JSON.parse(read(CONFIG_FILES.keys)));
    const verified = verifyConfig(JSON.parse(read(CONFIG_FILES.signed)), JSON.parse(read(CONFIG_FILES.source)), keys);
    expect(verified.signedBy).toBe(keys.production.length > 0 ? 'production' : 'dev');
    expect(keys.dev).toBe(devPublicKey());
  });

  it('is written as the tool writes it (block and sign leave no stray diff)', () => {
    for (const file of Object.values(CONFIG_FILES)) {
      expect(read(file).replace(/\r\n/g, '\n'), file).toBe(`${JSON.stringify(JSON.parse(read(file)), null, 2)}\n`);
    }
  });
});
