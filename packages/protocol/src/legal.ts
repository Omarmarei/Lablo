/**
 * The terms of use and the privacy policy (RELAY step 40d), in English and Arabic: ONE source for
 * the TV's Settings › "About Lablo" (apps/tv/src/settings, loaded with settings.js, never in
 * main.js) and the web app's `/terms` and `/privacy` pages (apps/web).
 *
 * THE TEXT IS A FACTUAL DRAFT FOR COUNSEL (Omar's answer, leg 153): it says what the app and the
 * servers do today (architecture.md §3: what is kept, for how long), in plain words, and every
 * page of it carries `LEGAL_DRAFT_MARK` while `LEGAL_DRAFT` is true. Counsel's text replaces it
 * before launch (the legal track, PLAN.md §7); that edit sets `LEGAL_DRAFT` to false. The release
 * check (`tools/build/src/legal-gate.ts`, `pnpm build:tv --release`) refuses a build while it is
 * true, and a unit test ties the privacy text to the retention numbers below.
 *
 * Plain data and one function: this module imports NOTHING (an e2e spec and the web app read it;
 * zod stays out of the TV's settings.js). Plain words only, no markup.
 */

export type LegalLang = 'en' | 'ar';
export type LegalDocId = 'terms' | 'privacy';

/** True while the text is the draft. Counsel's final text sets it to false. */
export const LEGAL_DRAFT = true;

/** The mark every page of a draft carries, per language. */
export const LEGAL_DRAFT_MARK: Readonly<Record<LegalLang, string>> = { en: 'Draft for counsel', ar: 'مسودة للمراجعة القانونية' };

/** The day this text was last written (ISO date), shown on the web pages. */
export const LEGAL_UPDATED = '2026-11-25';

/** Where to write about the terms, the privacy policy or an infringement notice (public on purpose). */
export const LEGAL_CONTACT = 'lablo.iptv@gmail.com';

/** How long the servers keep what they keep, in days (architecture.md §3.2 "Retention"); the privacy text says the same numbers. */
export const RETENTION_DAYS = { backup: 180, telemetry: 90, report: 30 } as const;

export interface LegalSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

export interface LegalDoc {
  readonly title: string;
  readonly sections: readonly LegalSection[];
}

/** The words around the documents on the TV (the page's buttons and counter) and on the web. */
export interface LegalChrome {
  /** The "About Lablo" page's title. */
  readonly about: string;
  readonly aboutLine: string;
  readonly disclaimer: readonly string[];
  readonly version: string;
  readonly terms: string;
  readonly termsHint: string;
  readonly privacy: string;
  readonly privacyHint: string;
  readonly previous: string;
  readonly next: string;
  readonly close: string;
  /** "Page 2 of 6". */
  readonly pageOf: (n: number, total: number) => string;
  readonly updated: string;
  readonly contact: string;
  readonly switchTo: string;
  readonly switchLabel: string;
}

const EN_TERMS: LegalDoc = {
  title: 'Terms of use',
  sections: [
    {
      heading: 'What Lablo is',
      paragraphs: [
        'Lablo is a media player for your TV. It provides no channels, films, series, music or other content, and it is not linked to any content provider, reseller or panel.',
        'By using Lablo you accept these terms. If you do not accept them, please do not use the app.',
      ],
    },
    {
      heading: 'Your sources',
      paragraphs: [
        'To watch anything you add a playlist (M3U) or a login (Xtream) from a provider. Lablo never supplies one and never suggests one.',
        'You are responsible for what you add, and for having the right to watch it where you live.',
      ],
    },
    {
      heading: 'What you must not do',
      paragraphs: [
        'Do not use Lablo to watch, copy or share content you have no right to use, or to get around a protection on it.',
        'Do not use Lablo to attack, overload or probe our servers, and do not resell it or its backup and pairing services.',
      ],
    },
    {
      heading: 'Our servers',
      paragraphs: [
        'Backup, pairing a phone, usage reports and the support report are optional services. We may change, limit or stop them.',
        'To follow a court order or a valid notice, we can switch off a feature or block a source address in Lablo remotely, for everyone or for one country.',
      ],
    },
    {
      heading: 'Infringement notices',
      paragraphs: [
        `If you believe something is being used with Lablo in a way that infringes your rights, write to ${LEGAL_CONTACT} with what is infringed, where, and how to reach you.`,
        'The name of our designated agent for such notices will be added here before launch.',
      ],
    },
    {
      heading: 'No warranty, limits, contact',
      paragraphs: [
        'Lablo is provided as it is and as available, free of charge, without any promise that it works with your provider or never fails. To the extent the law allows, we are not liable for loss from its use, or from what you watch with it.',
        `We may update these terms; the date is on the web page. The governing law and the court will be named in the final text. Questions: ${LEGAL_CONTACT}.`,
      ],
    },
  ],
};

const EN_PRIVACY: LegalDoc = {
  title: 'Privacy policy',
  sections: [
    {
      heading: 'In short',
      paragraphs: [
        'Your playlists, logins, favourites and viewing stay on your TV. We have no account for you, no advertising and no tracking of what you watch.',
        'Three optional things leave your TV: an encrypted backup, a phone pairing and anonymous usage reports. You can turn each off. This page says what each one sends and for how long it is kept.',
      ],
    },
    {
      heading: 'Your sources',
      paragraphs: [
        'The links and logins you add are kept on your TV. Lablo contacts your provider from the TV itself; our servers never fetch your provider and never see your streams.',
        'A link or a login leaves the TV only inside a backup or a phone pairing, and only encrypted (see below).',
      ],
    },
    {
      heading: "The TV's ID and your backup",
      paragraphs: [
        "With your consent at first start, Lablo uses this TV's device ID to find and encrypt a backup of your sources and favourites, so they come back after an update or a reset. The ID itself never leaves your TV.",
        `The backup is encrypted on the TV before it is sent, so we cannot read it. It is kept under an ID that cannot be traced to you, and deleted after ${RETENTION_DAYS.backup} days without an update. You can turn it off, or leave out your logins, in Settings.`,
      ],
    },
    {
      heading: 'Pairing your phone',
      paragraphs: [
        "When you add a source from your phone, the TV shows a short code and a link. What you type on the phone is encrypted for your TV only, so the server passes on a message it cannot read.",
        'A pairing is deleted after one hour, and a file you send from the phone after 24 hours.',
      ],
    },
    {
      heading: 'Usage and crash reports',
      paragraphs: [
        'Lablo can send anonymous reports: which app version and kind of TV, how often playback starts, stalls or fails (as rough counts), and the kind of error. They never hold your links, logins or channel names, and use a random install number that changes after a wipe.',
        `They are kept ${RETENTION_DAYS.telemetry} days. You can turn them off in Settings.`,
      ],
    },
    {
      heading: 'The report to support',
      paragraphs: [
        "Only when you choose \"Send a report to support\", Lablo sends your TV's model, the app's state and recent errors, with no ID, no links and no logins. You get a support code to quote when you write to us.",
        `The report is kept ${RETENTION_DAYS.report} days. Your internet address is used to limit abuse and is not stored.`,
      ],
    },
    {
      heading: 'Your rights, contact',
      paragraphs: [
        'You can delete your backup from Settings, and turn off reports at any time. Because we hold no account and no readable data about you, most requests need nothing from us. If you want to ask about your data, write to ' + LEGAL_CONTACT + '.',
        'Counsel will add the legal bases and the rights under the laws of the countries where Lablo is offered before launch.',
      ],
    },
  ],
};

const AR_TERMS: LegalDoc = {
  title: 'شروط الاستخدام',
  sections: [
    {
      heading: 'ما هو لابلو',
      paragraphs: [
        'لابلو مشغّل وسائط لتلفازك. لا يقدّم أي قنوات أو أفلام أو مسلسلات أو موسيقى أو أي محتوى آخر، وليس مرتبطًا بأي مزوّد محتوى أو موزّع أو لوحة اشتراكات.',
        'باستخدامك لابلو فإنك توافق على هذه الشروط. إن لم توافق عليها فنرجو ألا تستخدم التطبيق.',
      ],
    },
    {
      heading: 'مصادرك',
      paragraphs: [
        'لكي تشاهد أي شيء تضيف قائمة تشغيل (M3U) أو بيانات دخول (Xtream) من مزوّد. لابلو لا يقدّم لك واحدًا ولا يقترح عليك واحدًا.',
        'أنت المسؤول عمّا تضيفه، وعن امتلاك الحق في مشاهدته في البلد الذي تقيم فيه.',
      ],
    },
    {
      heading: 'ما لا يجوز لك فعله',
      paragraphs: [
        'لا تستخدم لابلو لمشاهدة محتوى أو نسخه أو مشاركته إن لم يكن لك حق في استخدامه، ولا للالتفاف على حماية موضوعة عليه.',
        'لا تستخدم لابلو لمهاجمة خوادمنا أو إرهاقها أو فحصها، ولا تعِد بيعه أو بيع خدمتي النسخ الاحتياطي والاقتران التابعتين له.',
      ],
    },
    {
      heading: 'خوادمنا',
      paragraphs: [
        'النسخ الاحتياطي واقتران الهاتف وتقارير الاستخدام وتقرير الدعم خدمات اختيارية. قد نغيّرها أو نحدّ منها أو نوقفها.',
        'لتنفيذ أمر قضائي أو إخطار صحيح، يمكننا إيقاف ميزة في لابلو أو حظر عنوان مصدر عن بُعد، للجميع أو لبلد واحد.',
      ],
    },
    {
      heading: 'إخطارات التعدّي',
      paragraphs: [
        `إذا رأيت أن شيئًا يُستخدم مع لابلو بما ينتهك حقوقك، فاكتب إلى ${LEGAL_CONTACT} موضحًا ما انتُهك وأين وكيف نتواصل معك.`,
        'سيُضاف هنا قبل الإطلاق اسم الوكيل المعيّن لتلقّي هذه الإخطارات.',
      ],
    },
    {
      heading: 'عدم الضمان وحدود المسؤولية والتواصل',
      paragraphs: [
        'يُقدَّم لابلو كما هو وحسب توفّره ومجانًا، دون أي وعد بأنه يعمل مع مزوّدك أو بأنه لن يتعطّل. وبالقدر الذي يسمح به القانون لا نتحمّل مسؤولية أي خسارة ناتجة عن استخدامه أو عمّا تشاهده به.',
        `قد نحدّث هذه الشروط، وتاريخ آخر تحديث على صفحة الويب. وسيُذكر القانون الواجب التطبيق والمحكمة المختصة في النص النهائي. للاستفسار: ${LEGAL_CONTACT}.`,
      ],
    },
  ],
};

const AR_PRIVACY: LegalDoc = {
  title: 'سياسة الخصوصية',
  sections: [
    {
      heading: 'باختصار',
      paragraphs: [
        'قوائمك وبيانات دخولك ومفضلاتك وما تشاهده تبقى على تلفازك. ليس لدينا حساب لك ولا إعلانات ولا تتبّع لما تشاهده.',
        'ثلاثة أشياء اختيارية تغادر تلفازك: نسخة احتياطية مشفّرة، واقتران بهاتف، وتقارير استخدام مجهولة. يمكنك إيقاف كل منها. توضح هذه الصفحة ما يرسله كل منها ومدة الاحتفاظ به.',
      ],
    },
    {
      heading: 'مصادرك',
      paragraphs: [
        'الروابط وبيانات الدخول التي تضيفها تُحفظ على تلفازك. يتصل لابلو بمزوّدك من التلفاز نفسه؛ وخوادمنا لا تتصل بمزوّدك ولا ترى بثّك أبدًا.',
        'لا يغادر الرابط أو بيانات الدخول التلفاز إلا داخل نسخة احتياطية أو اقتران بهاتف، ومشفّرًا فقط (انظر أدناه).',
      ],
    },
    {
      heading: 'معرّف التلفاز ونسختك الاحتياطية',
      paragraphs: [
        'بموافقتك عند أول تشغيل، يستخدم لابلو معرّف جهاز هذا التلفاز للعثور على نسخة احتياطية من مصادرك ومفضلاتك وتشفيرها، لتعود بعد التحديث أو إعادة الضبط. أما المعرّف نفسه فلا يغادر تلفازك أبدًا.',
        `تُشفَّر النسخة على التلفاز قبل إرسالها، لذلك لا نستطيع قراءتها. تُحفظ تحت معرّف لا يمكن ربطه بك، وتُحذف بعد ${RETENTION_DAYS.backup} يومًا دون تحديث. يمكنك إيقافها، أو استثناء بيانات الدخول منها، من الإعدادات.`,
      ],
    },
    {
      heading: 'اقتران هاتفك',
      paragraphs: [
        'عندما تضيف مصدرًا من هاتفك يعرض التلفاز رمزًا قصيرًا ورابطًا. ما تكتبه على الهاتف يُشفَّر لتلفازك وحده، فيمرّر الخادم رسالة لا يستطيع قراءتها.',
        'يُحذف الاقتران بعد ساعة واحدة، ويُحذف الملف الذي ترسله من الهاتف بعد 24 ساعة.',
      ],
    },
    {
      heading: 'تقارير الاستخدام والأعطال',
      paragraphs: [
        'قد يرسل لابلو تقارير مجهولة: إصدار التطبيق ونوع التلفاز، وعدد مرات بدء التشغيل أو التعثّر أو الفشل (كأعداد تقريبية)، ونوع الخطأ. لا تحتوي أبدًا على روابطك أو بيانات دخولك أو أسماء القنوات، وتستخدم رقم تثبيت عشوائيًا يتغيّر بعد المسح.',
        `يُحتفظ بها ${RETENTION_DAYS.telemetry} يومًا. يمكنك إيقافها من الإعدادات.`,
      ],
    },
    {
      heading: 'تقرير الدعم',
      paragraphs: [
        'فقط حين تختار «إرسال تقرير إلى الدعم» يرسل لابلو طراز تلفازك وحالة التطبيق وأحدث الأخطاء، دون معرّف ودون روابط ودون بيانات دخول. وتحصل على رمز دعم تذكره عند مراسلتنا.',
        `يُحتفظ بالتقرير ${RETENTION_DAYS.report} يومًا. يُستخدم عنوان الإنترنت الخاص بك للحدّ من إساءة الاستخدام ولا يُخزَّن.`,
      ],
    },
    {
      heading: 'حقوقك والتواصل',
      paragraphs: [
        `يمكنك حذف نسختك الاحتياطية من الإعدادات وإيقاف التقارير في أي وقت. ولأننا لا نحتفظ بحساب ولا ببيانات مقروءة عنك، فمعظم الطلبات لا تحتاج منا شيئًا. للاستفسار عن بياناتك اكتب إلى ${LEGAL_CONTACT}.`,
        'سيضيف المستشار القانوني قبل الإطلاق الأسس القانونية والحقوق بموجب قوانين الدول التي يُعرض فيها لابلو.',
      ],
    },
  ],
};

const EN_CHROME: LegalChrome = {
  about: 'About Lablo',
  aboutLine: 'The version, what Lablo is, the terms and the privacy policy',
  disclaimer: [
    'Lablo is a player. It provides no channels, films or other content, and it is not linked to any provider.',
    'To watch, add a playlist or a login from a provider you have the right to use. You are responsible for what you add.',
  ],
  version: 'Version',
  terms: 'Terms of use',
  termsHint: 'What you may and may not do with Lablo',
  privacy: 'Privacy policy',
  privacyHint: 'What stays on your TV, what is sent, and for how long',
  previous: 'Previous',
  next: 'Next',
  close: 'Close',
  pageOf: (n, total) => `Page ${n} of ${total}`,
  updated: 'Last updated',
  contact: 'Contact',
  switchTo: 'العربية',
  switchLabel: 'Read this page in Arabic',
};

const AR_CHROME: LegalChrome = {
  about: 'عن لابلو',
  aboutLine: 'الإصدار، وما هو لابلو، والشروط وسياسة الخصوصية',
  disclaimer: [
    'لابلو مشغّل. لا يقدّم أي قنوات أو أفلام أو محتوى آخر، وليس مرتبطًا بأي مزوّد.',
    'لكي تشاهد أضف قائمة تشغيل أو بيانات دخول من مزوّد لك الحق في استخدامه. أنت المسؤول عمّا تضيفه.',
  ],
  version: 'الإصدار',
  terms: 'شروط الاستخدام',
  termsHint: 'ما يجوز لك وما لا يجوز مع لابلو',
  privacy: 'سياسة الخصوصية',
  privacyHint: 'ما يبقى على تلفازك وما يُرسل ومدة الاحتفاظ به',
  previous: 'السابق',
  next: 'التالي',
  close: 'إغلاق',
  pageOf: (n, total) => `صفحة ${n} من ${total}`,
  updated: 'آخر تحديث',
  contact: 'التواصل',
  switchTo: 'English',
  switchLabel: 'قراءة هذه الصفحة بالإنجليزية',
};

export const LEGAL_DOCS: Readonly<Record<LegalLang, Readonly<Record<LegalDocId, LegalDoc>>>> = {
  en: { terms: EN_TERMS, privacy: EN_PRIVACY },
  ar: { terms: AR_TERMS, privacy: AR_PRIVACY },
};

export const LEGAL_CHROME: Readonly<Record<LegalLang, LegalChrome>> = { en: EN_CHROME, ar: AR_CHROME };

export function legalDoc(lang: LegalLang, id: LegalDocId): LegalDoc {
  return LEGAL_DOCS[lang][id];
}
