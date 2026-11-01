// `pnpm fixtures [--out .cache/fixtures] [--seed N] [--only catalog|xmltv] [--no-time-limit]`
// Writes the deterministic scale fixtures and fails if they take longer than 2 minutes
// (RELAY step 4). Serve them with `pnpm mock --catalog .cache/fixtures/catalog.json
// --xmltv .cache/fixtures/xmltv-300mb.xml.gz`.

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_FIXTURES_OUT, DEFAULT_SEED, TIME_LIMIT_MS, generateFixtures } from './src/generate';

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: DEFAULT_FIXTURES_OUT },
    seed: { type: 'string', default: String(DEFAULT_SEED) },
    only: { type: 'string' },
    'no-time-limit': { type: 'boolean', default: false },
  },
});

if (values.only && !['catalog', 'xmltv'].includes(values.only)) {
  console.error(`--only must be catalog or xmltv, not ${values.only}`);
  process.exit(2);
}
const outDir = resolve(values.out);
console.log(`Writing scale fixtures to ${outDir} (seed ${values.seed})`);
const manifest = await generateFixtures({
  outDir,
  seed: Number(values.seed),
  catalog: values.only !== 'xmltv',
  xmltv: values.only !== 'catalog',
  log: (line) => console.log(`  ${line}`),
});
const total = Object.values(manifest.files).reduce((sum, f) => sum + f.bytes + (f.gzBytes ?? 0), 0);
console.log(`Done in ${(manifest.ms / 1000).toFixed(1)} s, ${(total / 1e6).toFixed(0)} MB (manifest.json has the SHA-256 of every file).`);
if (!values['no-time-limit'] && manifest.ms > TIME_LIMIT_MS) {
  console.error(`Too slow: ${(manifest.ms / 1000).toFixed(1)} s is over the ${TIME_LIMIT_MS / 1000} s limit (RELAY step 4).`);
  process.exit(1);
}
