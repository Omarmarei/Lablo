/**
 * Settings › "Help"'s words (RELAY step 40c), in English and Arabic. They are NOT in the catalogs
 * (`apps/tv/src/i18n`): every catalog key of both languages ships in main.js, and the help is long.
 * This file sits under apps/tv/src/settings/, so it loads with settings.js (the build fails on a
 * static import that would pull it into main.js). The row's name and line ("Help") are catalog keys.
 *
 * The names of the app's own rows and buttons come in from the catalogs (`HelpNames`), so a help
 * line says what the screen says, in both languages. A topic is a title, a line for the topics'
 * list and its blocks; the page draws them in order. `pseudo` (en-XA) goes through
 * `pseudoLocalize` in the page, as the catalogs do.
 *
 * Main-safe code, as the settings are: no regex, no `.split(`, no spread. It imports nothing (the e2e
 * spec reads the address and the topics from it, and an import reaching `@lablo/ui` breaks root tsc).
 */

/** The support address, public on purpose (Omar's answer, step 40's refinement). */
export const SUPPORT_EMAIL = 'lablo.iptv@gmail.com';

export type HelpTopic = 'add' | 'play' | 'account' | 'stream' | 'other' | 'keys' | 'support';

/** The topics in the order of the page. */
export const HELP_TOPICS: readonly HelpTopic[] = ['add', 'play', 'account', 'stream', 'other', 'keys', 'support'];

/** One block of a topic's page. */
export type HelpBlock =
  /** A paragraph. */
  | { readonly kind: 'p'; readonly text: string }
  /** A term and what it says: an error code (`ltr`, never translated) or a remote's key. */
  | { readonly kind: 'item'; readonly term: string; readonly text: string; readonly ltr: boolean }
  /** The support address, left to right in both languages, after its label. */
  | { readonly kind: 'mail'; readonly text: string }
  /** The support code "Send a report to support" showed (its label), or `none` when it hasn't sent one. */
  | { readonly kind: 'code'; readonly text: string; readonly none: string };

export interface HelpTopicText {
  readonly title: string;
  /** The line under the topic's name in the list. */
  readonly hint: string;
  readonly blocks: readonly HelpBlock[];
}

/** The catalog names a help line quotes: the screen's own words. */
export interface HelpNames {
  readonly sources: string;
  readonly addPhone: string;
  readonly connection: string;
  readonly report: string;
}

function p(text: string): HelpBlock {
  return { kind: 'p', text };
}

function code(term: string, text: string): HelpBlock {
  return { kind: 'item', term, text, ltr: true };
}

function key(term: string, text: string): HelpBlock {
  return { kind: 'item', term, text, ltr: false };
}

function english(n: HelpNames): Readonly<Record<HelpTopic, HelpTopicText>> {
  return {
    add: {
      title: 'Add a playlist or a login',
      hint: 'Your provider’s link or login, from your phone',
      blocks: [
        p(`Open Settings, then “${n.sources}”. Choose “${n.addPhone}”, open the page it shows on your phone and type your playlist link or your provider’s login there.`),
        p('Your provider gives you either a playlist link (M3U) or a server address with a username and a password (Xtream). Lablo has no channels of its own.'),
        p(`To change a login later, open “${n.sources}” and choose the source.`),
      ],
    },
    play: {
      title: 'A channel doesn’t play',
      hint: 'What the message on the screen means',
      blocks: [
        p('When a channel fails, a card names the cause and shows a code. The cause is one of four:'),
        key('Internet', 'Your TV is offline or the network is down.'),
        key('Provider', 'Your provider’s server or your account.'),
        key('TV', 'This TV can’t play that kind of stream.'),
        key('App', 'A fault in Lablo itself.'),
        p(`“${n.connection}” in Settings tells you which one it is.`),
      ],
    },
    account: {
      title: 'Codes: your account',
      hint: 'PRV-AUTH, PRV-EXPIRED and two more',
      blocks: [
        code('PRV-AUTH', 'The provider refused the login. Check the username and the password.'),
        code('PRV-EXPIRED', 'The subscription has ended. Ask your provider.'),
        code('PRV-BLOCKED', 'The provider has blocked the account.'),
        code('PRV-MAX-CONNECTIONS', 'The account is already in use on as many screens as it allows.'),
      ],
    },
    stream: {
      title: 'Codes: the stream',
      hint: 'PRV-HTTP, PRV-TIMEOUT and three more',
      blocks: [
        code('PRV-HTTP', 'The server answered with an error. A number after the code is its answer: 404, the channel is gone; 5xx, the server is in trouble.'),
        code('PRV-UNREACHABLE', 'The provider’s server didn’t answer.'),
        code('PRV-TIMEOUT', 'The server took too long to answer.'),
        code('PRV-STALLED', 'The picture stopped and didn’t come back.'),
        code('PRV-BAD-STREAM', 'The stream is damaged, or isn’t a video.'),
      ],
    },
    other: {
      title: 'Codes: the TV, the internet, the app',
      hint: 'NET-OFFLINE, TV-UNSUPPORTED, APP-ERROR',
      blocks: [
        code('NET-OFFLINE', 'The TV has no internet connection.'),
        code('TV-UNSUPPORTED', 'This TV can’t play that format.'),
        code('APP-ERROR', 'A fault in Lablo. Send a report to support.'),
        code('CFG-BLOCKLIST', 'This link is on a list of addresses Lablo doesn’t open.'),
      ],
    },
    keys: {
      title: 'The remote’s keys',
      hint: 'Colour keys, channel keys and the rest',
      blocks: [
        key('OK', 'Choose. On a channel: show the info bar.'),
        key('Back', 'One screen back. On a channel: close it.'),
        key('Up, Down, CH+, CH−', 'On a channel: the next and the previous channel.'),
        key('0–9', 'Type a channel number, then OK.'),
        key('Info', 'Show or hide the info bar.'),
        key('Yellow, Prev', 'Back to the last channel.'),
        key('Red', 'The favourites of the channel.'),
        key('Green, Guide', 'The TV guide.'),
        key('Blue', 'Search, on the channel list.'),
        key('Audio, Subtitles', 'The sound and subtitle choices.'),
      ],
    },
    support: {
      title: 'Contact support',
      hint: 'The address and your support code',
      blocks: [
        p('Tell us what happens, on which channel, and what the screen says.'),
        { kind: 'mail', text: 'Write to' },
        p(`Choose “${n.report}” in Settings first. It sends your TV’s model, the app’s state and recent errors, never your links or logins, and shows a support code. Give us that code with your question.`),
        { kind: 'code', text: 'Your support code', none: 'No code yet.' },
      ],
    },
  };
}

function arabic(n: HelpNames): Readonly<Record<HelpTopic, HelpTopicText>> {
  return {
    add: {
      title: 'إضافة قائمة تشغيل أو بيانات دخول',
      hint: 'رابط مزوّدك أو بيانات دخوله، من هاتفك',
      blocks: [
        p(`افتح الإعدادات ثم «${n.sources}». اختر «${n.addPhone}» وافتح الصفحة التي تظهر على هاتفك، واكتب فيها رابط قائمة التشغيل أو بيانات دخول مزوّدك.`),
        p('يعطيك مزوّدك إمّا رابط قائمة تشغيل (M3U) أو عنوان خادم مع اسم مستخدم وكلمة مرور (Xtream). لا يقدّم لابلو أي قنوات بنفسه.'),
        p(`لتغيير بيانات الدخول لاحقًا، افتح «${n.sources}» واختر المصدر.`),
      ],
    },
    play: {
      title: 'قناة لا تعمل',
      hint: 'معنى الرسالة التي تظهر على الشاشة',
      blocks: [
        p('عندما تفشل قناة، تظهر بطاقة تذكر السبب ورمزًا. السبب واحد من أربعة:'),
        key('الإنترنت', 'التلفزيون غير متصل أو الشبكة متوقفة.'),
        key('المزوّد', 'خادم مزوّدك أو حسابك.'),
        key('التلفزيون', 'لا يستطيع هذا التلفزيون تشغيل هذا النوع من البث.'),
        key('التطبيق', 'عطل في لابلو نفسه.'),
        p(`«${n.connection}» في الإعدادات يخبرك أيّها هو.`),
      ],
    },
    account: {
      title: 'الرموز: حسابك',
      hint: 'PRV-AUTH وPRV-EXPIRED ورمزان آخران',
      blocks: [
        code('PRV-AUTH', 'رفض المزوّد بيانات الدخول. تحقّق من اسم المستخدم وكلمة المرور.'),
        code('PRV-EXPIRED', 'انتهى الاشتراك. اسأل مزوّدك.'),
        code('PRV-BLOCKED', 'حظر المزوّد الحساب.'),
        code('PRV-MAX-CONNECTIONS', 'الحساب مستخدم بالفعل على أقصى عدد من الشاشات يسمح به.'),
      ],
    },
    stream: {
      title: 'الرموز: البث',
      hint: 'PRV-HTTP وPRV-TIMEOUT وثلاثة أخرى',
      blocks: [
        code('PRV-HTTP', 'ردّ الخادم بخطأ. الرقم بعد الرمز هو ردّه: 404 القناة لم تعد موجودة، و5xx الخادم يعاني من مشكلة.'),
        code('PRV-UNREACHABLE', 'لم يردّ خادم المزوّد.'),
        code('PRV-TIMEOUT', 'تأخّر الخادم كثيرًا في الرد.'),
        code('PRV-STALLED', 'توقفت الصورة ولم تعد.'),
        code('PRV-BAD-STREAM', 'البث تالف، أو ليس فيديو.'),
      ],
    },
    other: {
      title: 'الرموز: التلفزيون والإنترنت والتطبيق',
      hint: 'NET-OFFLINE وTV-UNSUPPORTED وAPP-ERROR',
      blocks: [
        code('NET-OFFLINE', 'التلفزيون غير متصل بالإنترنت.'),
        code('TV-UNSUPPORTED', 'لا يستطيع هذا التلفزيون تشغيل هذه الصيغة.'),
        code('APP-ERROR', 'عطل في لابلو. أرسل تقريرًا إلى الدعم.'),
        code('CFG-BLOCKLIST', 'هذا الرابط ضمن قائمة عناوين لا يفتحها لابلو.'),
      ],
    },
    keys: {
      title: 'أزرار جهاز التحكم',
      hint: 'الأزرار الملونة وأزرار القنوات وغيرها',
      blocks: [
        key('OK', 'اختيار. على قناة: إظهار شريط المعلومات.'),
        key('رجوع', 'شاشة واحدة إلى الخلف. على قناة: إغلاقها.'),
        key('أعلى، أسفل، CH+، CH−','على قناة: القناة التالية والسابقة.'),
        key('0–9', 'اكتب رقم قناة ثم OK.'),
        key('Info', 'إظهار شريط المعلومات أو إخفاؤه.'),
        key('الأصفر، Prev', 'العودة إلى القناة الأخيرة.'),
        key('الأحمر', 'مفضّلات القناة.'),
        key('الأخضر، Guide', 'دليل البرامج.'),
        key('الأزرق', 'البحث، في قائمة القنوات.'),
        key('Audio، Subtitles', 'خيارات الصوت والترجمة.'),
      ],
    },
    support: {
      title: 'التواصل مع الدعم',
      hint: 'العنوان ورمز الدعم الخاص بك',
      blocks: [
        p('أخبرنا بما يحدث، وعلى أي قناة، وماذا تقول الشاشة.'),
        { kind: 'mail', text: 'راسلنا على' },
        p(`اختر «${n.report}» في الإعدادات أولًا. يرسل طراز تلفزيونك وحالة التطبيق والأعطال الأخيرة، دون روابطك أو بيانات دخولك أبدًا، ويعرض رمز دعم. أعطنا هذا الرمز مع سؤالك.`),
        { kind: 'code', text: 'رمز الدعم الخاص بك', none: 'لا يوجد رمز بعد.' },
      ],
    },
  };
}

/** A topic's words in a language (Arabic, else English: the app has two languages). */
export function helpTopic(language: 'en' | 'ar', names: HelpNames, topic: HelpTopic): HelpTopicText {
  return (language === 'ar' ? arabic(names) : english(names))[topic];
}
