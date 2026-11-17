/** `pnpm sign-config`: see src/cli.ts and docs/runbooks/config.md. */
import path from 'node:path';
import { defaultEnv, runSignConfig } from './src/cli';

const ROOT = path.resolve(import.meta.dirname, '../..');

process.exitCode = runSignConfig(process.argv.slice(2), defaultEnv(ROOT));
