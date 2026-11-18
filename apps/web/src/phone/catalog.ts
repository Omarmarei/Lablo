/**
 * The phone page's text in English and Arabic (RELAY step 31b). `apps/web` may import only
 * `protocol` and `crypto`, so the TV's catalogs (`apps/tv/src/i18n`) are out of reach: this is the
 * page's own small one, in the TV's terms (its `field.*` and `error.*` texts where they apply).
 * `test/phone-catalog.test.ts` holds the two languages to the same keys, placeholders and plural
 * forms.
 *
 * A message is a string, or plural forms chosen by `Intl.PluralRules` for `{n}` (`#` is the
 * number). Placeholders are `{name}`; each value goes in between FSI and PDI, so a code, a link or
 * a brand keeps its own direction inside the other language's sentence.
 */
import type { Lang } from './lang';

type Plural = Readonly<Partial<Record<Intl.LDMLPluralRule, string>>> & { readonly other: string };
export type Message = string | Plural;

export const EN = {
  'meta.title': 'Lablo: send a source to your TV',
  'meta.description': 'Send your IPTV login or playlist link to Lablo on your TV, encrypted on your phone.',
  'app.name': 'Lablo',
  'lang.other': 'العربية',

  'code.title': 'Send a source to your TV',
  'code.body': 'Type the code Lablo shows on your TV, or scan the QR code next to it with your phone’s camera.',
  'code.label': 'Code from your TV',
  'code.continue': 'Continue',
  'code.checking': 'Checking the code…',
  'code.format': 'A code has 8 letters and numbers, like {example}.',
  'code.unknown': 'No TV is showing this code. Check it and try again.',
  'code.ended': 'This code has ended. Show a new code on your TV, then scan it or type it here.',

  'error.limited': { one: 'Too many tries. Try again in # minute.', other: 'Too many tries. Try again in # minutes.' },
  'error.network': 'Couldn’t reach Lablo. Check your internet connection and try again.',

  'form.title': 'Add your source',
  'form.for': 'For the TV showing {code}',
  'form.otherCode': 'Use another code',
  'form.body': 'Use the details your provider gave you. Lablo comes with no sources of its own.',
  'form.type': 'Source type',
  'type.xtream': '{name} login',
  'type.m3u': '{format} playlist link',
  'type.file': '{format} playlist file',
  'field.server': 'Server address',
  'field.serverHint': 'As your provider sent it. {scheme} is added if you leave it out.',
  'field.username': 'Username',
  'field.password': 'Password',
  'field.showPassword': 'Show password',
  'field.playlist': 'Playlist link',
  'field.linkHint': 'Starts with {http} or {https}',
  'field.file': 'Playlist file',
  'field.fileChoose': 'Choose a file',
  'field.fileChange': 'Choose another file',
  'field.fileHint': 'The {format} file your provider sent you, up to {max}',
  'field.fileChosen': '{name}, {size}',
  'field.noFile': 'Choose the playlist file',
  'field.fileEmpty': 'This file is empty',
  'field.fileLarge': 'This file is larger than {max}',
  'field.fileUnreadable': 'This file couldn’t be read. Choose it again.',
  'size.kb': '{n} KB',
  'size.mb': '{n} MB',
  'field.epg': 'Guide link (optional)',
  'field.epgHint': 'An {format} link, if your provider gave you one',
  'field.epgAdd': 'Add another guide link',
  'field.epgRemove': 'Remove this guide link',
  'field.name': 'Name (optional)',
  'field.nameHint': 'Shown in your list of sources',
  'field.required': 'Fill this in',
  'field.url': 'Enter a link that starts with {http} or {https}',
  'field.spaces': 'A link can’t contain spaces',
  'field.long': 'This is too long',
  'form.private': 'Your details are encrypted on this phone. Only your TV can read them.',
  'form.check': 'Check the fields marked above.',
  'form.send': 'Send to TV',
  'form.sending': 'Sending…',
  'form.sendingFile': 'Encrypting and sending the file…',

  'progress.title': 'Sending to your TV',
  'progress.sent': 'Sent',
  'progress.sentWaiting': 'Sent. Waiting for your TV to pick it up.',
  'progress.received': 'Received by your TV',
  'progress.receivedChecking': 'Your TV has it. Checking the source…',
  'progress.result': 'Result',

  'done.okTitle': 'Added',
  'done.ok': 'Your TV is loading the source now.',
  'done.failedTitle': 'Your TV couldn’t add it',
  'done.auth_failed': 'The provider didn’t accept this username and password.',
  'done.expired': 'This account has expired. Contact your provider.',
  'done.unreachable': 'Your TV couldn’t reach the server. Check the address and try again.',
  'done.blocked': 'This source can’t be used with Lablo.',
  'done.newCode': 'Sending again needs a new code from your TV.',
  'done.fix': 'Fix and send again',
  'done.another': 'Add another source',

  'lost.title': 'Check your TV',
  'lost.body': 'This page can no longer follow the code, so your TV is the place to see how it went.',
  'lost.again': 'Send with a new code',
} as const satisfies Readonly<Record<string, Message>>;

export type MessageKey = keyof typeof EN;

export const AR: Readonly<Record<MessageKey, Message>> = {
  'meta.title': 'لابلو: أرسل مصدرًا إلى تلفازك',
  'meta.description': 'أرسل بيانات دخول IPTV أو رابط قائمة التشغيل إلى لابلو على تلفازك، مشفّرة على هاتفك.',
  'app.name': 'لابلو',
  'lang.other': 'English',

  'code.title': 'أرسل مصدرًا إلى تلفازك',
  'code.body': 'اكتب الرمز الذي يعرضه لابلو على تلفازك، أو امسح رمز QR المجاور له بكاميرا هاتفك.',
  'code.label': 'الرمز الظاهر على تلفازك',
  'code.continue': 'متابعة',
  'code.checking': 'جارٍ التحقق من الرمز…',
  'code.format': 'يتكوّن الرمز من 8 أحرف وأرقام، مثل {example}.',
  'code.unknown': 'لا يعرض أي تلفاز هذا الرمز. تحقّق منه وحاول مرة أخرى.',
  'code.ended': 'انتهت صلاحية هذا الرمز. اعرض رمزًا جديدًا على تلفازك، ثم امسحه أو اكتبه هنا.',

  'error.limited': {
    zero: 'محاولات كثيرة جدًا. حاول مرة أخرى بعد قليل.',
    one: 'محاولات كثيرة جدًا. حاول مرة أخرى بعد دقيقة واحدة.',
    two: 'محاولات كثيرة جدًا. حاول مرة أخرى بعد دقيقتين.',
    few: 'محاولات كثيرة جدًا. حاول مرة أخرى بعد # دقائق.',
    many: 'محاولات كثيرة جدًا. حاول مرة أخرى بعد # دقيقة.',
    other: 'محاولات كثيرة جدًا. حاول مرة أخرى بعد # دقيقة.',
  },
  'error.network': 'تعذّر الاتصال بلابلو. تحقّق من اتصالك بالإنترنت وحاول مرة أخرى.',

  'form.title': 'أضف مصدرك',
  'form.for': 'إلى التلفاز الذي يعرض الرمز {code}',
  'form.otherCode': 'استخدام رمز آخر',
  'form.body': 'استخدم البيانات التي أرسلها لك مزوّد الخدمة. لا يأتي لابلو بأي مصادر خاصة به.',
  'form.type': 'نوع المصدر',
  'type.xtream': 'تسجيل دخول {name}',
  'type.m3u': 'رابط قائمة تشغيل {format}',
  'type.file': 'ملف قائمة تشغيل {format}',
  'field.server': 'عنوان الخادم',
  'field.serverHint': 'كما أرسله مزوّد الخدمة. تُضاف {scheme} إن لم تكتبها.',
  'field.username': 'اسم المستخدم',
  'field.password': 'كلمة المرور',
  'field.showPassword': 'إظهار كلمة المرور',
  'field.playlist': 'رابط قائمة التشغيل',
  'field.linkHint': 'يبدأ بـ {http} أو {https}',
  'field.file': 'ملف قائمة التشغيل',
  'field.fileChoose': 'اختيار ملف',
  'field.fileChange': 'اختيار ملف آخر',
  'field.fileHint': 'ملف {format} الذي أرسله لك مزوّد الخدمة، بحجم {max} كحدّ أقصى',
  'field.fileChosen': '{name}، {size}',
  'field.noFile': 'اختر ملف قائمة التشغيل',
  'field.fileEmpty': 'هذا الملف فارغ',
  'field.fileLarge': 'حجم هذا الملف أكبر من {max}',
  'field.fileUnreadable': 'تعذّرت قراءة هذا الملف. اختره مرة أخرى.',
  'size.kb': '{n} كيلوبايت',
  'size.mb': '{n} ميغابايت',
  'field.epg': 'رابط الدليل (اختياري)',
  'field.epgHint': 'رابط {format}، إن أعطاك إياه مزوّد الخدمة',
  'field.epgAdd': 'إضافة رابط دليل آخر',
  'field.epgRemove': 'إزالة رابط الدليل هذا',
  'field.name': 'الاسم (اختياري)',
  'field.nameHint': 'يظهر في قائمة مصادرك',
  'field.required': 'هذا الحقل مطلوب',
  'field.url': 'أدخل رابطًا يبدأ بـ {http} أو {https}',
  'field.spaces': 'لا يمكن أن يحتوي الرابط على مسافات',
  'field.long': 'هذا النص أطول من المسموح',
  'form.private': 'تُشفَّر بياناتك على هذا الهاتف، ولا يستطيع قراءتها إلا تلفازك.',
  'form.check': 'تحقّق من الحقول المُشار إليها أعلاه.',
  'form.send': 'إرسال إلى التلفاز',
  'form.sending': 'جارٍ الإرسال…',
  'form.sendingFile': 'جارٍ تشفير الملف وإرساله…',

  'progress.title': 'جارٍ الإرسال إلى تلفازك',
  'progress.sent': 'تم الإرسال',
  'progress.sentWaiting': 'تم الإرسال. بانتظار أن يستلمه تلفازك.',
  'progress.received': 'استلمه تلفازك',
  'progress.receivedChecking': 'استلمه تلفازك. جارٍ التحقق من المصدر…',
  'progress.result': 'النتيجة',

  'done.okTitle': 'تمت الإضافة',
  'done.ok': 'يحمّل تلفازك المصدر الآن.',
  'done.failedTitle': 'تعذّر على تلفازك إضافته',
  'done.auth_failed': 'لم يقبل مزوّد الخدمة اسم المستخدم وكلمة المرور هذين.',
  'done.expired': 'انتهت صلاحية هذا الحساب. تواصل مع مزوّد الخدمة.',
  'done.unreachable': 'تعذّر على تلفازك الوصول إلى الخادم. تحقّق من العنوان وحاول مرة أخرى.',
  'done.blocked': 'لا يمكن استخدام هذا المصدر مع لابلو.',
  'done.newCode': 'تحتاج إلى رمز جديد من تلفازك لإعادة الإرسال.',
  'done.fix': 'التعديل والإرسال مجددًا',
  'done.another': 'إضافة مصدر آخر',

  'lost.title': 'تحقّق من تلفازك',
  'lost.body': 'لم تعد هذه الصفحة قادرة على متابعة الرمز، لذا ستجد النتيجة على تلفازك.',
  'lost.again': 'الإرسال برمز جديد',
};

export const CATALOGS: Readonly<Record<Lang, Readonly<Record<MessageKey, Message>>>> = { en: EN, ar: AR };

/** First Strong Isolate and Pop Directional Isolate. */
export const FSI = String.fromCharCode(0x2068);
export const PDI = String.fromCharCode(0x2069);

export type Params = Readonly<Record<string, string | number>>;

/**
 * A file's size as the form shows it: whole kilobytes under a megabyte (rounded up: 0 only when
 * empty), else megabytes to one decimal (`2.5 MB`, `40 MB`). Binary units, as the 1 MiB frames
 * and the 40 MiB limit.
 */
export function fileSize(lang: Lang, bytes: number): string {
  if (bytes < 1048576) return t(lang, 'size.kb', { n: Math.ceil(bytes / 1024) });
  return t(lang, 'size.mb', { n: Math.round((bytes / 1048576) * 10) / 10 });
}

/** The message for `key` in `lang`, its plural form chosen by `params.n`, its placeholders filled. */
export function t(lang: Lang, key: MessageKey, params: Params = {}): string {
  const message = CATALOGS[lang][key];
  let text: string;
  if (typeof message === 'string') text = message;
  else {
    const n = Number(params.n ?? 0);
    text = (message[new Intl.PluralRules(lang).select(n)] ?? message.other).replace(/#/g, String(n));
  }
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? `${FSI}${String(params[name])}${PDI}` : whole));
}
