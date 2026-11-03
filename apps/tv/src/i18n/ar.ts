import type { MessageKey } from './en';

/**
 * The Arabic catalog (Modern Standard Arabic, for the GCC). Plurals give all six forms: zero,
 * one, two, few (3–10: the plural noun), many (11–99: the singular in the accusative) and
 * other (100 and up: the singular).
 */
export const AR: Readonly<Record<MessageKey, string>> = {
  'gallery.title': 'المكوّنات',
  'gallery.channelCount': '{n, plural, zero {لا توجد قنوات} one {قناة واحدة} two {قناتان} few {# قنوات} many {# قناةً} other {# قناة}}',
  'gallery.selected': 'المحدّد: {what}',
  'gallery.pressOk': 'اضغط «موافق» على أي عنصر',
  'gallery.continueWatching': 'متابعة المشاهدة',
  'gallery.status': 'التقدّم والحالة',
  'gallery.loading': 'جارٍ تحميل القنوات',
  'gallery.guideUpdated': 'تم تحديث الدليل',
  'gallery.timeline': 'شريط الوسائط',
  'gallery.playMessage': 'يأتي التشغيل مع المشغّل. هذا مكوّن الحوار.',

  'action.play': 'تشغيل',
  'action.favourite': 'أضف إلى المفضلة',
  'action.removeSource': 'إزالة المصدر',
  'action.record': 'تسجيل',
  'action.cancel': 'إلغاء',

  'category.all': 'كل القنوات',
  'category.favourites': 'المفضلة',
  'category.sports': 'رياضة',
  'category.news': 'أخبار',
  'category.movies': 'أفلام',
  'category.kids': 'أطفال',
  'category.documentaries': 'وثائقيات',
  'category.music': 'موسيقى',
  'category.radio': 'راديو',

  'guide.next': 'التالي',
  'guide.none': 'لا يوجد دليل لهذه القناة',

  'badge.live': 'مباشر',
  'badge.new': 'جديد',
  'badge.catchUp': 'إعادة المشاهدة',
  'badge.expires':
    '{days, plural, zero {ينتهي اليوم} one {ينتهي خلال يوم واحد} two {ينتهي خلال يومين} few {ينتهي خلال # أيام} many {ينتهي خلال # يومًا} other {ينتهي خلال # يوم}}',

  'play.title': 'تشغيل {name}؟',
  'exit.title': 'الخروج من زوما؟',
  'exit.message': 'يمكنك العودة في أي وقت.',
  'exit.stay': 'البقاء',
  'exit.confirm': 'خروج',
};
