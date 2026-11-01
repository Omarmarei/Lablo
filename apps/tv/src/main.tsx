import { render } from 'preact';
import { App } from './App';
import { KEY_HELP, createPlatform } from './platform';

const platform = createPlatform();
platform.registerKeys();

const root = document.getElementById('app');
if (root === null) throw new Error('#app element missing from index.html');
render(<App platform={platform} keyHelp={KEY_HELP} />, root);
