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

  'app.name': 'زوما',

  'onboarding.chooseLanguage': 'اختر لغتك',
  'onboarding.disclaimerTitle': 'زوما مشغّل وسائط',
  'onboarding.disclaimerBody': 'لا يقدّم زوما أي قنوات أو أفلام أو محتوى آخر، ولا يرتبط بأي مزوّد خدمة.',
  'onboarding.disclaimerAdd': 'للمشاهدة، أضف قائمة تشغيل أو بيانات دخول من مزوّد يحق لك استخدام خدمته. أنت مسؤول عمّا تضيفه.',
  'onboarding.understand': 'فهمت',
  'onboarding.consentTitle': 'استخدام معرّف هذا التلفاز للنسخة الاحتياطية؟',
  'onboarding.consentBody':
    'يمكن لزوما استخدام معرّف هذا التلفاز لتشفير نسخة احتياطية من مصادرك ومفضلتك، فتعود بعد تحديث التطبيق أو إعادة الضبط. لا يغادر المعرّف نفسه تلفازك أبدًا.',
  'onboarding.backupNote':
    'النسخ الاحتياطي مفعّل افتراضيًا، ويُشفَّر على تلفازك قبل إرساله، فلا يمكننا قراءته. يمكنك إيقافه أو استثناء بيانات الدخول من الإعدادات.',
  'onboarding.consentNo': 'إن لم تسمح بذلك، تعرض الإعدادات رمزًا احتياطيًا لتدوّنه بدلًا منه.',
  'onboarding.allow': 'سماح',
  'onboarding.notNow': 'ليس الآن',
  'onboarding.sourceTitle': 'أضف مصدرك',
  'onboarding.sourceBody': 'استخدم البيانات التي أرسلها لك مزوّد الخدمة. لا يأتي زوما بأي مصادر خاصة به.',
  'onboarding.xtream': 'تسجيل دخول {name}',
  'onboarding.xtreamHint': 'عنوان خادم واسم مستخدم وكلمة مرور',
  'onboarding.m3u': 'رابط قائمة تشغيل {format}',
  'onboarding.m3uHint': 'رابط إلى ملف قائمة تشغيل',
  'onboarding.typeHint': 'اضغط «موافق» على أي حقل للكتابة، ثم «موافق» مرة أخرى عند الانتهاء.',
  'onboarding.add': 'إضافة المصدر',

  'field.server': 'عنوان الخادم',
  'field.serverHint': 'كما أرسله مزوّد الخدمة. تُضاف {scheme} إن لم تكتبها.',
  'field.username': 'اسم المستخدم',
  'field.password': 'كلمة المرور',
  'field.playlist': 'رابط قائمة التشغيل',
  'field.linkHint': 'يبدأ بـ {http} أو {https}',
  'field.epg': 'رابط الدليل (اختياري)',
  'field.epgHint': 'رابط {format}، إن أعطاك إياه مزوّد الخدمة',
  'field.name': 'الاسم (اختياري)',
  'field.nameHint': 'يظهر في قائمة مصادرك',
  'field.required': 'هذا الحقل مطلوب',
  'field.url': 'أدخل رابطًا يبدأ بـ {http} أو {https}',
  'field.spaces': 'لا يمكن أن يحتوي الرابط على مسافات',

  'loading.title': 'جارٍ إضافة {name}',
  'loading.checking': 'جارٍ التحقق من البيانات',
  'loading.download':
    'جارٍ التحميل: {n, plural, zero {لا توجد عناصر بعد} one {عنصر واحد} two {عنصران} few {# عناصر} many {# عنصرًا} other {# عنصر}}',
  'loading.saving': 'جارٍ الحفظ',
  'loading.guide': 'جارٍ تحميل الدليل',
  'loading.failed': 'تعذّرت إضافة {name}',
  'loading.edit': 'تعديل البيانات',
  'loading.retry': 'إعادة المحاولة',

  'error.auth': 'لم يقبل مزوّد الخدمة اسم المستخدم وكلمة المرور هذين.',
  'error.expired': 'انتهت صلاحية هذا الحساب. تواصل مع مزوّد الخدمة.',
  'error.blocked': 'أوقف مزوّد الخدمة هذا الحساب أو عطّله. تواصل مع مزوّد الخدمة.',
  'error.network': 'تعذّر الوصول إلى الخادم. تحقّق من العنوان ومن اتصالك بالإنترنت.',
  'error.http': 'ردّ الخادم برمز الخطأ {status, number}.',
  'error.format': 'لم يُرجع هذا الرابط قائمة تشغيل.',
  'error.empty': 'لا توجد قنوات في قائمة التشغيل.',
  'error.other': 'حدث خطأ ما. حاول مرة أخرى.',

  'done.title': 'كل شيء جاهز',
  'done.body': '{name} جاهز.',
  'done.live': '{n, plural, zero {لا توجد قنوات} one {قناة واحدة} two {قناتان} few {# قنوات} many {# قناةً} other {# قناة}}',
  'done.movies': '{n, plural, zero {لا توجد أفلام} one {فيلم واحد} two {فيلمان} few {# أفلام} many {# فيلمًا} other {# فيلم}}',
  'done.series': '{n, plural, zero {لا توجد مسلسلات} one {مسلسل واحد} two {مسلسلان} few {# مسلسلات} many {# مسلسلًا} other {# مسلسل}}',
  'done.start': 'ابدأ المشاهدة',
};
