/**
 * @zoma/ui: the focus engine (step 10); the virtual list, EPG grid, design tokens,
 * components and i18n runtime follow in steps 11–12 and 23. See docs/architecture.md §1.2.
 */
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
