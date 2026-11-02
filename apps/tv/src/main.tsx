import { signal } from '@preact/signals';
import { render } from 'preact';
import type { AppData } from './App';
import { App } from './App';
import { readDebugParams } from './data/params';
import { createAppDataEngine } from './data/workers';
import { createFocusDemo } from './focus-demo';
import { KEY_HELP, createPlatform } from './platform';

const platform = createPlatform();
platform.registerKeys();

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

const root = document.getElementById('app');
if (root === null) throw new Error('#app element missing from index.html');
render(<App platform={platform} keyHelp={KEY_HELP} data={data} focus={createFocusDemo(platform)} />, root);
