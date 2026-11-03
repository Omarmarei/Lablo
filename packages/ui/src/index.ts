/**
 * @zoma/ui: the focus engine (step 10) and the design system (step 11: tokens and fonts; the
 * components and the virtual list follow); the i18n runtime and the EPG grid come in steps
 * 12 and 23. See docs/architecture.md §1.2.
 *
 * The CSS is imported here, first, so it comes before the app's own CSS in app.css and in
 * Vite's dev server (tools/build/src/css.ts orders it by the imports).
 */
import './styles/fonts.css';
import './styles/tokens.css';

export { FOCUS_RING, LAYOUT, SCREEN, SPACE, fits, pxTokens } from './design/tokens';
export type { BackOutcome, Focus, HandleResult, Navigator, NavigatorOptions, Screen, ScreenSpec } from './focus/navigator';
export { createNavigator } from './focus/navigator';
export { watchPointerMoves } from './focus/pointer';
export type {
  Direction,
  EpgCell,
  EpgZone,
  FreeZone,
  GridZone,
  ListZone,
  Neighbours,
  Rect,
  TextDirection,
  ZonePosition,
  ZoneSpec,
} from './focus/types';
export { moveDirection } from './focus/types';
