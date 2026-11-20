import type { ReadonlySignal } from '@preact/signals';
import { render } from 'preact';
import type { Platform } from '@lablo/platform-api';
import type { Navigator } from '@lablo/ui';
import type { AppData } from '../App';
import { App } from '../App';
import type { HelloConfig } from '../DataPanel';
import type { DataEngine } from '../data/engine';
import type { AppScreen } from '../data/params';
import { readChecks, readDebugParams } from '../data/params';
import { createFocusDemo } from '../focus-demo';
import { GalleryApp } from '../gallery/GalleryApp';
import { createGallery } from '../gallery/gallery-state';
import { GuideGalleryApp } from '../gallery/GuideGalleryApp';
import { createGuideGallery } from '../gallery/guide-gallery';
import { KEY_HELP } from '../platform';
// Last, so the hello screen's CSS comes after @lablo/ui's (tokens, fonts, components) in app.css and in dev.
import './dev-screens.css';

/**
 * The developer screens behind `?screen=` (RELAY step 35b): the component gallery (step 11b), the
 * grid guide's gallery page (step 23b) and the hello screen (the device, the workers and the data
 * layer; steps 2, 8b and 30c1).
 *
 * The desktop dev app has them, and so does the TV build's test copy (`build:tv`'s `dev` target,
 * dist/tv-dev), which the old-engine harness's hello and gallery runs and e2e/tv-bundle.spec.ts
 * open. The store build (dist/tv) takes `dev-screens.store.ts` instead (tools/build's
 * `STORE_SWAPS`), so none of their code, their CSS or the hello worker ships, and `?screen=`
 * starts the app as a TV does. Omar's decision of 2026-11-20: about 31 KB of main.js, and the
 * hello screen's CSS (dev-screens.css) out of app.css.
 */

/** What the developer screens take from main. */
export interface DevScreenContext {
  readonly platform: Platform;
  /** Tells the test hook which navigator has the focus (`installTestHook`). */
  readonly showFocus: (nav: Pick<Navigator, 'snapshot'> | null) => void;
  readonly dataEngine: () => DataEngine;
  /** This build's config request (the hello screen's config row, step 30c1). */
  readonly configRequest: HelloConfig['request'];
  /** Remote keys are being pressed (a running refresh pauses). */
  readonly busy: ReadonlySignal<boolean>;
}

/** Shows `screen` into `into` when it is a developer screen, and answers whether it was one. */
export function showDevScreen(screen: AppScreen, into: Element, context: DevScreenContext): boolean {
  const { platform, showFocus } = context;
  if (screen === 'gallery') {
    // The component gallery (step 11b): no data workers.
    const gallery = createGallery(platform);
    showFocus(gallery.nav);
    render(<GalleryApp platform={platform} gallery={gallery} />, into);
    return true;
  }
  if (screen === 'gallery-guide') {
    // The grid guide's gallery page (step 23b): made-up rows, no data workers.
    const guide = createGuideGallery(platform);
    showFocus(guide.nav);
    render(<GuideGalleryApp platform={platform} gallery={guide} />, into);
    return true;
  }
  if (screen !== 'hello') return false;
  const data: AppData = {
    engine: context.dataEngine(),
    params: readDebugParams(location.search),
    // One config run on this screen (step 30c1): it starts no schedule.
    config: { request: context.configRequest, checks: readChecks(location.search) },
    busy: context.busy,
  };
  const focus = createFocusDemo(platform);
  showFocus(focus.nav);
  render(<App platform={platform} keyHelp={KEY_HELP} data={data} focus={focus} />, into);
  return true;
}
