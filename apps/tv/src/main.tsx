import { signal } from '@preact/signals';
import { render } from 'preact';
import type { DeviceTier } from '@zoma/core';
import type { Language } from '@zoma/ui';
import { Spinner } from '@zoma/ui';
import type { AppData } from './App';
import { App } from './App';
import type { DataEngine } from './data/engine';
import { readDebugParams, readScreen } from './data/params';
import { createAppDataEngine } from './data/workers';
import { createFocusDemo } from './focus-demo';
import { GalleryApp } from './gallery/GalleryApp';
import { createGallery } from './gallery/gallery-state';
import { createEngineLoader } from './onboarding/engine-loader';
import { OnboardingApp } from './onboarding/OnboardingApp';
import type { Onboarding } from './onboarding/onboarding-state';
import { createOnboarding } from './onboarding/onboarding-state';
import { answerEdit, readStartProfile, startPoint } from './onboarding/start';
import { KEY_HELP, createPlatform } from './platform';
// Last, so the app's own CSS comes after @zoma/ui's (tokens, fonts, components) in app.css and in dev.
import './app.css';

const platform = createPlatform();
platform.registerKeys();

const root = document.getElementById('app');
if (root === null) throw new Error('#app element missing from index.html');

/** Remote keys are being pressed (a running refresh pauses). */
const busy = signal(false);
let engine: DataEngine | null = null;

/** The data engine, started once and shared by every screen. */
function dataEngine(): DataEngine {
  if (engine === null) {
    engine = createAppDataEngine({
      onBusy: (value) => {
        busy.value = value;
      },
    });
  }
  return engine;
}

/** The hello screen: developer diagnostics of the device, the workers and the data layer. */
function showHello(into: Element): void {
  const data: AppData = { engine: dataEngine(), params: readDebugParams(location.search), busy };
  render(<App platform={platform} keyHelp={KEY_HELP} data={data} focus={createFocusDemo(platform)} />, into);
}

/**
 * Onboarding (RELAY steps 13a and 13b): the source loads through the data engine, and every
 * answer goes into the profile as it is given. Until the live screen (step 14), "Start
 * watching" opens the hello screen.
 */
function showOnboarding(into: Element, language: Language | null): void {
  const data = dataEngine();
  let onboarding: Onboarding | null = null;
  const loader = createEngineLoader({
    engine: data,
    tier: () => platform.info().then(
      (info) => info.tier,
      (): DeviceTier => 'full',
    ),
    languages: () => {
      const picked = onboarding?.language.peek() ?? null;
      return picked === null ? [] : [picked];
    },
  });
  const started = createOnboarding({
    platform,
    loader,
    initial: { language },
    answer: (answer) => {
      // Best effort: an answer that can't be saved is asked again on the next start.
      data.editProfile(answerEdit(answer)).catch((error: unknown) => console.warn('The onboarding answer was not saved', error));
    },
  });
  onboarding = started;
  const finish = (): void => {
    started.dispose();
    showHello(into);
  };
  render(<OnboardingApp platform={platform} onboarding={started} onFinish={finish} />, into);
}

const screen = readScreen(location.search);
if (screen === 'gallery') {
  // The component gallery (RELAY step 11b): no data workers.
  render(<GalleryApp platform={platform} gallery={createGallery(platform)} />, root);
} else if (screen === 'hello') {
  showHello(root);
} else {
  // The profile decides: a stored source skips onboarding (step 13b).
  render(
    <main class="onboarding" data-testid="onboarding" data-ready="false">
      <Spinner size="l" />
    </main>,
    root,
  );
  void readStartProfile(dataEngine()).then((profile) => {
    const start = startPoint(profile);
    if (start.screen === 'home') showHello(root);
    else showOnboarding(root, start.language);
  });
}
