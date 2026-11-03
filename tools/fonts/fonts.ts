/**
 * `pnpm fonts`: writes the app's woff2 font subsets (tools/fonts/src/spec.ts) into
 * packages/ui/assets/fonts, with `fonts.json` (what the tests check the committed files
 * against) and the fonts' licence. The sources are downloaded once into .cache/fonts at a
 * pinned commit and checked by SHA-256. Run it after changing a range, a weight or a source,
 * then commit the outputs; CI never downloads fonts.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inspectFont, subsetToWoff2, toTrueType } from './src/inspect';
import type { FontManifest, FontSource } from './src/spec';
import { FACES, FAMILY, LICENCES, SOURCES, rangeCodePoints } from './src/spec';

const ROOT = path.resolve(import.meta.dirname, '../..');
const CACHE = path.join(ROOT, '.cache/fonts');
const OUT = path.join(ROOT, 'packages/ui/assets/fonts');

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

async function fetchPinned(source: FontSource): Promise<Buffer> {
  const file = path.join(CACHE, source.file);
  if (existsSync(file)) {
    const cached = readFileSync(file);
    if (sha256(cached) === source.sha256) return cached;
  }
  console.log(`  downloading ${source.url}`);
  const response = await fetch(source.url);
  if (!response.ok) throw new Error(`${source.url}: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  const actual = sha256(data);
  if (actual !== source.sha256) throw new Error(`${source.file}: SHA-256 ${actual}, expected ${source.sha256}`);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(file, data);
  return data;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const faces: FontManifest['faces'][number][] = [];
  for (const face of FACES) {
    const source = SOURCES[face.source];
    const original = await fetchPinned(source);
    const available = inspectFont(original).codePoints;
    const wanted = rangeCodePoints(face.unicodeRange).filter((cp) => available.has(cp));
    const woff2 = await subsetToWoff2(original, wanted);
    writeFileSync(path.join(OUT, face.file), woff2);
    faces.push({
      file: face.file,
      weight: face.weight,
      unicodeRange: face.unicodeRange,
      source: source.file,
      sourceSha256: source.sha256,
      sha256: sha256(woff2),
      bytes: woff2.length,
      codePoints: wanted.length,
    });
    const subset = inspectFont(await toTrueType(woff2));
    console.log(`  ${face.file}: ${(woff2.length / 1024).toFixed(1)} KB, ${subset.codePoints.size} code points (${source.file})`);
  }

  const licences: string[] = [];
  for (const licence of LICENCES) licences.push((await fetchPinned(licence)).toString('utf8').trim());
  writeFileSync(
    path.join(OUT, 'OFL.txt'),
    `The Zoma Sans font files are subsets of Noto Sans and Noto Sans Arabic UI, unmodified\notherwise, under the SIL Open Font License 1.1:\n\n${licences.join('\n\n----\n\n')}\n`,
  );
  const manifest: FontManifest = { family: FAMILY, faces };
  writeFileSync(path.join(OUT, 'fonts.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`  wrote ${path.relative(ROOT, OUT)}/{${FACES.map((f) => f.file).join(',')},fonts.json,OFL.txt}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
