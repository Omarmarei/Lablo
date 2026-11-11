import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Root } from 'postcss';
import postcss from 'postcss';
import { tvPostcssPlugins } from '../../../tv-css.config';
import { CssGateError, checkCss, formatCssViolations } from './css-gate';

/**
 * The TV build's CSS (ADR-003): every `.css` file the bundle imports, in import order,
 * as one app.css for Chromium 53.
 *   1. Each `url()` (fonts, images) is copied next to it under `assets/` and rewritten.
 *   2. The shared PostCSS plugins (tv-css.config.ts: postcss-rtlcss) run on the result.
 *   3. The Chromium 53 CSS gate checks the output and fails the build on a violation.
 * The Vite dev loop runs the same plugins (apps/tv/vite.config.ts) and serves the assets itself.
 */
export interface CssAsset {
  /** Absolute path of the source file. */
  readonly from: string;
  /** Path inside the staged app, e.g. `assets/lablo-sans-arabic-400.woff2`. */
  readonly to: string;
}

export interface CssBuild {
  readonly css: string;
  readonly assets: readonly CssAsset[];
}

export const ASSET_DIR = 'assets';

const URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/** Copies nothing: decides each `url()`'s staged path and rewrites it in place. */
function rewriteUrls(root: Root, assets: Map<string, CssAsset>): void {
  root.walkDecls((decl) => {
    if (!decl.value.includes('url(')) return;
    const file = decl.source?.input.file;
    decl.value = decl.value.replace(URL_PATTERN, (match, _quote, target: string) => {
      if (target.startsWith('data:')) return match;
      const at = `${file ?? 'app.css'}: url(${target})`;
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) {
        // The app is packaged: nothing is fetched from a server, and never a provider's.
        throw new CssGateError(`${at}: remote URLs are not allowed in the TV CSS; put the file in the repo`);
      }
      if (file === undefined) throw new CssGateError(`${at}: a relative url() needs the source file to resolve against`);
      const from = path.resolve(path.dirname(file), target.split(/[?#]/)[0] ?? target);
      if (!existsSync(from)) throw new CssGateError(`${at}: ${from} does not exist`);
      const to = `${ASSET_DIR}/${path.basename(from)}`;
      const known = [...assets.values()].find((a) => a.to === to);
      if (known !== undefined && known.from !== from) {
        throw new CssGateError(`${at}: ${to} is already ${known.from}; give the files different names`);
      }
      assets.set(from, { from, to });
      return `url(${JSON.stringify(to)})`;
    });
  });
}

/** Builds app.css from `files` (absolute paths, in import order). */
export async function buildCss(files: readonly string[], label = 'app.css'): Promise<CssBuild> {
  const root = postcss.root();
  for (const file of files) {
    const parsed = postcss.parse(readFileSync(file, 'utf8'), { from: file });
    root.append(parsed.nodes.slice());
  }
  const assets = new Map<string, CssAsset>();
  rewriteUrls(root, assets);

  const result = await postcss(tvPostcssPlugins()).process(root, { from: undefined, to: label });
  const violations = checkCss(result.root);
  if (violations.length > 0) throw new CssGateError(formatCssViolations(label, violations));
  return { css: result.css, assets: [...assets.values()] };
}
