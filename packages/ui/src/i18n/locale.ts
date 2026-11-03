import type { TextDirection } from '../focus/types';

/**
 * `rtl` for Arabic (and the other right-to-left languages) from a BCP 47 tag. The app puts it
 * on `<html dir>`, which app.css's mirrored rules follow, and hands it to the focus engine.
 */
export function localeDir(locale: string): TextDirection {
  return /^(ar|fa|he|ur)(-|$)/i.test(locale) ? 'rtl' : 'ltr';
}
