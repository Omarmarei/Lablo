// Build fixture (RELAY step 30b2): the app's build constants (tv-defines.config.ts) are replaced.
declare const __API_BASE__: string;
declare const __APP_VERSION__: string;
declare const __CONFIG_KEYS__: string[];

(globalThis as unknown as { fixture: unknown }).fixture = { base: __API_BASE__, version: __APP_VERSION__, keys: __CONFIG_KEYS__ };
