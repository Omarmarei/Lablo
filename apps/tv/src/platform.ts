import type { Platform, PlatformOptions } from '@zoma/platform-api';
import { BROWSER_KEY_HELP, createBrowserPlatform } from '@zoma/platform-browser';
import { createTizenPlatform } from '@zoma/platform-tizen';
import { createWebosPlatform } from '@zoma/platform-webos';

/**
 * The platform for this build. `__PLATFORM__` is a literal after replacement, so the
 * bundler drops the other adapters (tools/build checks that they are really gone).
 * `options.redirects`: where Tizen's redirect probe keeps its answers (the profile, step 20c1).
 */
export function createPlatform(options: PlatformOptions = {}): Platform {
  if (__PLATFORM__ === 'tizen') return createTizenPlatform(options);
  if (__PLATFORM__ === 'webos') return createWebosPlatform();
  return createBrowserPlatform();
}

const TV_KEY_HELP: ReadonlyArray<readonly [string, string]> = [
  ['Arrows, OK', 'Move, select'],
  ['Number keys', 'Digits'],
  ['Colour keys', 'Red, Green, Yellow, Blue'],
  ['Back', 'Back; exit on the first screen'],
];

/** On-screen key help: the keyboard layout on the desktop, the remote on a TV. */
export const KEY_HELP: ReadonlyArray<readonly [string, string]> =
  __PLATFORM__ === 'browser' ? BROWSER_KEY_HELP : TV_KEY_HELP;
