/**
 * @zoma/ui: the focus engine (step 10), the design system (step 11: tokens, fonts, the base
 * components, the virtual list and the en-XA pseudo-locale) and the i18n runtime (step 12:
 * messages, numbers, times and dates; the catalogs are the app's). The EPG grid comes in step
 * 23. See docs/architecture.md §1.2.
 *
 * The CSS is imported here, first, so it comes before the components' CSS and the app's own
 * in app.css and in Vite's dev server (tools/build/src/css.ts orders it by the imports).
 */
import './styles/fonts.css';
import './styles/tokens.css';

export { FOCUS_RING, LAYOUT, SCREEN, SPACE, fits, pxTokens } from './design/tokens';
export type { FocusBinding, ItemBinding, ItemState, ZoneView } from './focus/binding';
export { bindFocus, useFocus, useZone } from './focus/binding';
export type { BackOutcome, Focus, HandleResult, Navigator, NavigatorOptions, Screen, ScreenSpec } from './focus/navigator';
export { OK_CLICK_WINDOW_MS, createNavigator } from './focus/navigator';
export { watchPointerMoves } from './focus/pointer';
export type { RemoteOptions } from './focus/remote';
export { connectRemote } from './focus/remote';
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
export type { DateOrder, DateStyle, Digits, HourCycle, Language, LocaleOverrides, LocaleSettings, NameWidth } from './i18n/format';
export {
  DEFAULT_DIGITS,
  formatDate,
  formatDuration,
  formatNumber,
  formatPercent,
  formatTime,
  formatWeekday,
  resolveLocale,
  shapeDigits,
  tagRegion,
} from './i18n/format';
export { localeDir } from './i18n/locale';
export type { MessageArgs, MessagePart } from './i18n/message';
export { MessageSyntaxError, messageArguments, parseMessage, pluralBranches } from './i18n/message';
export { PSEUDO_LOCALE, pseudoLocalize } from './i18n/pseudo';
export type { Catalog, Catalogs, I18n, I18nOptions } from './i18n/runtime';
export { createI18n } from './i18n/runtime';

export type { BadgeProps, BadgeTone } from './components/Badge';
export { Badge } from './components/Badge';
export type { ButtonProps } from './components/Button';
export { Button } from './components/Button';
export type { ChipProps } from './components/Chip';
export { Chip } from './components/Chip';
export type { DialogProps } from './components/Dialog';
export { Dialog } from './components/Dialog';
export type { FocusableProps } from './components/focusable';
export type { ListRowProps, ProgrammeLine } from './components/ListRow';
export { ListRow } from './components/ListRow';
export type { ProgressBarProps } from './components/ProgressBar';
export { ProgressBar } from './components/ProgressBar';
export type { SpinnerProps } from './components/Spinner';
export { Spinner } from './components/Spinner';
export type { TileProps } from './components/Tile';
export { Tile } from './components/Tile';
export type { ListWindow, VirtualListProps } from './components/VirtualList';
export { VirtualList, listHeight, listWindow } from './components/VirtualList';
