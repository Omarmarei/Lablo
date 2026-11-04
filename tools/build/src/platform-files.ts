/**
 * Per-platform files around the bundle: index.html, the platform manifest (config.xml or
 * appinfo.json) with the app version filled in, and checks that each bundle carries only
 * its own platform adapter.
 */
export type TvPlatform = 'tizen' | 'webos';

export const TV_PLATFORMS: readonly TvPlatform[] = ['tizen', 'webos'];

/**
 * Runs before the bundle. If the bundle fails to parse or throws during boot on an old TV,
 * the error shows on screen instead of a blank page. Plain ES5; the syntax gate checks it too.
 */
export const BOOT_ERROR_SCRIPT = [
  'window.onerror = function (message, source, line, column) {',
  "  var box = document.getElementById('boot-error');",
  '  if (!box) return;',
  "  box.style.display = 'block';",
  "  box.textContent += 'Boot error: ' + message + ' (' + source + ':' + line + ':' + column + ')\\n';",
  '};',
].join('\n');

/** The classic-script page for a TV build (no ES modules on Chromium 53). */
export function renderIndexHtml(platform: TvPlatform): string {
  // Samsung's Product API (model, firmware) is injected by the TV at this virtual path.
  const platformScripts = platform === 'tizen' ? ['<script src="$WEBAPIS/webapis/webapis.js"></script>'] : [];
  return [
    '<!DOCTYPE html>',
    // The app sets lang and dir from the locale; app.css's mirrored rules need dir on <html>.
    '<html lang="en" dir="ltr">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>Zoma</title>',
    '<link rel="stylesheet" href="app.css">',
    `<script>${BOOT_ERROR_SCRIPT}</script>`,
    ...platformScripts,
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

/** Tizen and webOS both want `major.minor.patch`; Tizen caps them at 255.255.65535. */
export function assertAppVersion(version: string): void {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  const [major, minor, patch] = (match?.slice(1) ?? []).map(Number);
  if (major === undefined || minor === undefined || patch === undefined || major > 255 || minor > 255 || patch > 65535) {
    throw new Error(`apps/tv version "${version}" must be major.minor.patch, at most 255.255.65535`);
  }
}

/** Fills `{{version}}` in a platform manifest template. */
export function fillTemplate(template: string, version: string): string {
  if (!template.includes('{{version}}')) throw new Error('platform manifest has no {{version}} placeholder');
  return template.split('{{version}}').join(version);
}

/** Checks the rules the webOS build relies on; returns the parsed manifest. */
export function checkAppinfo(text: string, version: string): { id: string; version: string; requiredACG: readonly string[] } {
  const info = JSON.parse(text) as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof info.id !== 'string' || info.id === '') problems.push('"id" is missing');
  if (info.version !== version) problems.push(`"version" is ${JSON.stringify(info.version)}, expected "${version}"`);
  if (info.main !== 'index.html') problems.push('"main" must be "index.html"');
  if (info.type !== 'web') problems.push('"type" must be "web"');
  // The app handles Back itself (root Back policy, architecture.md §1.2).
  if (info.disableBackHistoryAPI !== true) problems.push('"disableBackHistoryAPI" must be true');
  // LG's ACG (ADR-012): mandatory on webOS 27+ and in the Seller Lounge; [] when no luna API is called.
  const acg = info.requiredACG;
  if (!Array.isArray(acg) || !acg.every((group) => typeof group === 'string')) problems.push('"requiredACG" must be an array of ACG group names');
  if (problems.length > 0) throw new Error(`platforms/webos/appinfo.json: ${problems.join('; ')}`);
  return { id: info.id as string, version, requiredACG: acg as string[] };
}

/** Checks the Tizen manifest; returns the application id used to launch the app. */
export function checkConfigXml(text: string, version: string): { appId: string } {
  const problems: string[] = [];
  if (!text.includes(`version="${version}"`)) problems.push(`widget version is not "${version}"`);
  if (!text.includes('<content src="index.html"/>')) problems.push('<content src="index.html"/> is missing');
  if (!text.includes('http://tizen.org/privilege/tv.inputdevice')) problems.push('the tv.inputdevice privilege is missing');
  const appId = /<tizen:application\s+id="([^"]+)"/.exec(text)?.[1];
  if (appId === undefined) problems.push('<tizen:application id="…"> is missing');
  if (problems.length > 0 || appId === undefined) throw new Error(`platforms/tizen/config.xml: ${problems.join('; ')}`);
  return { appId };
}

/**
 * Strings that prove another platform's adapter leaked into a bundle (the `__PLATFORM__`
 * define should have removed it).
 */
const FOREIGN_MARKERS: Record<TvPlatform, readonly string[]> = {
  // `com.webos.media`: the lab's luna selectTrack (S5, step 15c2).
  tizen: ['PalmSystem', 'webOSRelaunch', 'com.webos.media', 'Desktop browser'],
  // `application/avplayer` and `getTotalTrackInfo`: the lab's AVPlay player (S4, S8, step 15c2).
  webos: ['tvinputdevice', 'productinfo', 'application/avplayer', 'getTotalTrackInfo', 'Desktop browser'],
};

export function foreignCode(platform: TvPlatform, code: string): string[] {
  return FOREIGN_MARKERS[platform].filter((marker) => code.includes(marker));
}
