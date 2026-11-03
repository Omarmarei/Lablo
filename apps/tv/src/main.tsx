import { signal } from '@preact/signals';
import { render } from 'preact';
import type { AppData } from './App';
import { App } from './App';
import { readDebugParams, readScreen } from './data/params';
import { createAppDataEngine } from './data/workers';
import { createFocusDemo } from './focus-demo';
import { GalleryApp } from './gallery/GalleryApp';
import { createGallery } from './gallery/gallery-state';
import { KEY_HELP, createPlatform } from './platform';
// Last, so the app's own CSS comes after @zoma/ui's (tokens, fonts, components) in app.css and in dev.
import './app.css';

const platform = createPlatform();
platform.registerKeys();

const root = document.getElementById('app');
if (root === null) throw new Error('#app element missing from index.html');

if (readScreen(location.search) === 'gallery') {
  // The component gallery (RELAY step 11b): no data workers.
  render(<GalleryApp platform={platform} gallery={createGallery(platform)} />, root);
} else {
  const busy = signal(false);
  const data: AppData = {
    engine: createAppDataEngine({
      onBusy: (value) => {
        busy.value = value;
      },
    }),
    params: readDebugParams(location.search),
    busy,
  };
  render(<App platform={platform} keyHelp={KEY_HELP} data={data} focus={createFocusDemo(platform)} />, root);
}
