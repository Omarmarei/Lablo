import type { showDevScreen as DevScreens } from './dev-screens';

/**
 * The store build's stand-in for dev-screens.tsx (RELAY step 35b): no developer screen, so
 * `?screen=` starts the app as a TV does. tools/build swaps it in for every TV build but the test
 * copy (`STORE_SWAPS`); its type keeps the two alike.
 */
export const showDevScreen: typeof DevScreens = () => false;
