// Build fixture (RELAY steps 30b2 and 32b): the app's build constants (tv-defines.config.ts) are replaced.
declare const __API_BASE__: string;
declare const __APP_VERSION__: string;
declare const __CONFIG_KEYS__: string[];
declare const __APP_ID__: string;

(globalThis as unknown as { fixture: unknown }).fixture = { base: __API_BASE__, version: __APP_VERSION__, keys: __CONFIG_KEYS__, appId: __APP_ID__ };
