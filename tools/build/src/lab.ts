/**
 * The Zoma Lab build (RELAY step 15a, docs/architecture.md §5): the lab entry
 * (apps/tv/src/lab/lab-main.tsx) bundled like the app, staged in `dist/tv-lab/<platform>` as its
 * own app, so it installs next to Zoma instead of over it:
 *
 * - the manifests are the app's with the lab's id and name (`labManifest`);
 * - index.html runs the native-feature probe before the bundle (`renderLabIndexHtml`);
 * - `lab-config.js` holds the lab server's address (the mock provider on this PC, which collects
 *   the results), the lab's version and whether it runs everything at launch (`labConfigScript`).
 */
import type { NetworkInterfaceInfo } from 'node:os';
import type { TvPlatform } from './platform-files';
import { BOOT_ERROR_SCRIPT } from './platform-files';

/** The lab's ids: never the app's, so a lab install leaves the app (and its data) alone. */
export const LAB_IDS = {
  webosId: 'com.zoma.iptv.lab',
  /** Tizen: a 10-character package id, the application id `<package>.<name>`. */
  tizenPackage: 'ZomaLab001',
  tizenApplication: 'ZomaLab001.ZomaLab',
  tizenWidget: 'https://zoma-iptv.invalid/lab',
  title: 'Zoma Lab',
} as const;

/** S2's write test target (MB): its pass criterion, at least 200 MB writable (architecture.md §5). */
export const DEFAULT_LAB_WRITE_MB = 200;

export interface LabConfigFile {
  readonly server: string;
  readonly version: string;
  readonly writeMb: number;
  readonly autoRun: boolean;
}

function replaceOnce(text: string, pattern: RegExp, replacement: string, what: string): string {
  if (!pattern.test(text)) throw new Error(`lab manifest: ${what} not found`);
  return text.replace(pattern, replacement);
}

/** The app's manifest (already filled in) turned into the lab's: another id and name. */
export function labManifest(platform: TvPlatform, text: string): string {
  if (platform === 'webos') {
    const info = JSON.parse(text) as Record<string, unknown>;
    return `${JSON.stringify({ ...info, id: LAB_IDS.webosId, title: LAB_IDS.title }, null, 2)}\n`;
  }
  let out = replaceOnce(text, /(<widget\b[^>]*\bid=")[^"]*(")/, `$1${LAB_IDS.tizenWidget}$2`, 'the widget id');
  out = replaceOnce(out, /(<tizen:application\s+id=")[^"]*("\s+package=")[^"]*(")/, `$1${LAB_IDS.tizenApplication}$2${LAB_IDS.tizenPackage}$3`, 'the application id');
  return replaceOnce(out, /<name>[^<]*<\/name>/, `<name>${LAB_IDS.title}</name>`, 'the name');
}

/** `lab-config.js`: plain ES5, loaded before main.js. */
export function labConfigScript(config: LabConfigFile): string {
  return `window.ZOMA_LAB_CONFIG = ${JSON.stringify(config)};\n`;
}

/** The lab's classic-script page: the app's, plus the native probe and lab-config.js before main.js. */
export function renderLabIndexHtml(platform: TvPlatform, nativeProbe: string): string {
  const platformScripts = platform === 'tizen' ? ['<script src="$WEBAPIS/webapis/webapis.js"></script>'] : [];
  return [
    '<!DOCTYPE html>',
    '<html lang="en" dir="ltr">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${LAB_IDS.title}</title>`,
    '<link rel="stylesheet" href="app.css">',
    `<script>${BOOT_ERROR_SCRIPT}</script>`,
    `<script>${nativeProbe.trim()}</script>`,
    ...platformScripts,
    '<script src="lab-config.js"></script>',
    '</head>',
    '<body>',
    '<div id="boot-error" class="boot-error"></div>',
    '<div id="app"></div>',
    '<script src="main.js"></script>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

const PRIVATE_V4: readonly RegExp[] = [/^192\.168\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./];

/**
 * The address a TV on the LAN reaches this PC at: the first private IPv4 address (192.168.x
 * first, the usual home network), or 127.0.0.1 when there is none.
 */
export function lanAddress(interfaces: Readonly<Record<string, readonly NetworkInterfaceInfo[] | undefined>>): string {
  const candidates: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const entry of interfaces[name] ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) candidates.push(entry.address);
    }
  }
  for (const pattern of PRIVATE_V4) {
    const found = candidates.find((address) => pattern.test(address));
    if (found !== undefined) return found;
  }
  return '127.0.0.1';
}

/** `--lab-server`'s value checked: http(s)://host[:port], no path. */
export function checkLabServer(server: string): string {
  const trimmed = server.replace(/\/+$/, '');
  if (!/^https?:\/\/[^/?#\s]+$/i.test(trimmed)) throw new Error(`--lab-server must be http://host:port, not "${server}"`);
  return trimmed;
}
