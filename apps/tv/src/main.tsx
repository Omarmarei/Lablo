import { signal } from '@preact/signals';
import { render } from 'preact';
import type { AppData } from './App';
import { App } from './App';
import { readDebugParams, readScreen } from './data/params';
import { createAppDataEngine } from './data/workers';
import { createFocusDemo } from './focus-demo';
import { GalleryApp } from './gallery/GalleryApp';
import { createGallery } from './gallery/gallery-state';
import { createFakeLoader } from './onboarding/loader';
import { OnboardingApp } from './onboarding/OnboardingApp';
import { createOnboarding } from './onboarding/onboarding-state';
import { KEY_HELP, createPlatform } from './platform';
// Last, so the app's own CSS comes after @zoma/ui's (tokens, fonts, components) in app.css and in dev.
import './app.css';

const platform = createPlatform();
platform.registerKeys();

const root = document.getElementById('app');
if (root === null) throw new Error('#app element missing from index.html');

/** The hello screen: developer diagnostics of the device, the workers and the data layer. */
function showHello(into: Element): void {
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
  render(<App platform={platform} keyHelp={KEY_HELP} data={data} focus={createFocusDemo(platform)} />, into);
}

const screen = readScreen(location.search);
if (screen === 'gallery') {
  // The component gallery (RELAY step 11b): no data workers.
  render(<GalleryApp platform={platform} gallery={createGallery(platform)} />, root);
} else if (screen === 'hello') {
  showHello(root);
} else {
  // Onboarding (RELAY step 13a). A fake loader stands in until step 13b loads the source through
  // the data engine; until the live screen (step 14), "Start watching" opens the hello screen.
  const onboarding = createOnboarding({ platform, loader: createFakeLoader() });
  const finish = (): void => {
    onboarding.dispose();
    showHello(root);
  };
  render(<OnboardingApp platform={platform} onboarding={onboarding} onFinish={finish} />, root);
}
