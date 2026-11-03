import { PSEUDO_LOCALE, localeDir, pseudoLocalize } from '@zoma/ui';

/**
 * The gallery's words in English and Arabic (RELAY step 11b). Step 12 brings the real
 * catalogs and runtime (plural forms, digits, dates); until then this small table shows the
 * components with real Arabic, and `en-XA` runs the English through `pseudoLocalize`, as the
 * runtime will. Placeholders are `{name}`.
 */
const TEXT = {
  title: ['Components', 'المكوّنات'],
  channelCount: ['{n} channels', 'القنوات: {n}'],
  selected: ['Selected: {what}', 'المحدّد: {what}'],
  pressOk: ['Press OK on any item', 'اضغط «موافق» على أي عنصر'],
  play: ['Play', 'تشغيل'],
  favourite: ['Add to favourites', 'أضف إلى المفضلة'],
  remove: ['Remove source', 'إزالة المصدر'],
  record: ['Record', 'تسجيل'],
  all: ['All channels', 'كل القنوات'],
  favourites: ['Favourites', 'المفضلة'],
  sports: ['Sports', 'رياضة'],
  news: ['News', 'أخبار'],
  movies: ['Movies', 'أفلام'],
  kids: ['Kids', 'أطفال'],
  documentaries: ['Documentaries', 'وثائقيات'],
  music: ['Music', 'موسيقى'],
  radio: ['Radio', 'راديو'],
  next: ['Next', 'التالي'],
  noGuide: ['No guide for this channel', 'لا يوجد دليل لهذه القناة'],
  live: ['LIVE', 'مباشر'],
  new: ['NEW', 'جديد'],
  catchUp: ['Catch-up', 'إعادة المشاهدة'],
  expires: ['Expires in 3 days', 'ينتهي خلال 3 أيام'],
  continueWatching: ['Continue watching', 'متابعة المشاهدة'],
  status: ['Progress and status', 'التقدّم والحالة'],
  loading: ['Loading channels', 'جارٍ تحميل القنوات'],
  updated: ['Guide updated', 'تم تحديث الدليل'],
  timeline: ['Media timeline', 'شريط الوسائط'],
  playTitle: ['Play {name}?', 'تشغيل {name}؟'],
  playMessage: ['Playback arrives with the player. This is the Dialog component.', 'يأتي التشغيل مع المشغّل. هذا مكوّن الحوار.'],
  cancel: ['Cancel', 'إلغاء'],
  exitTitle: ['Exit Zoma?', 'الخروج من زوما؟'],
  exitMessage: ['You can come back any time.', 'يمكنك العودة في أي وقت.'],
  stay: ['Stay', 'البقاء'],
  exit: ['Exit', 'خروج'],
} as const;

export type TextKey = keyof typeof TEXT;
export type GalleryText = (key: TextKey, values?: Readonly<Record<string, string | number>>) => string;

/** Which column of the table a locale reads, and whether it is pseudo-localized. */
export type GalleryLanguage = 'en' | 'ar' | 'pseudo';

export function galleryLanguage(locale: string): GalleryLanguage {
  if (locale === PSEUDO_LOCALE) return 'pseudo';
  return localeDir(locale) === 'rtl' ? 'ar' : 'en';
}

/** Puts the values in place of `{name}`; unknown names stay as they are. */
function fill(message: string, values: Readonly<Record<string, string | number>> | undefined): string {
  if (values === undefined) return message;
  return message.replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : String(value);
  });
}

export function galleryText(locale: string): GalleryText {
  const language = galleryLanguage(locale);
  return (key, values) => {
    const [en, ar] = TEXT[key];
    const message = language === 'ar' ? ar : language === 'pseudo' ? pseudoLocalize(en) : en;
    return fill(message, values);
  };
}

/** Every key, for tests. */
export const TEXT_KEYS = Object.keys(TEXT) as TextKey[];
