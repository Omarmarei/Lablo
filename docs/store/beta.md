# The beta kit (RELAY step 52, for step 46)

What step 46's closed beta needs: how testers get a build before release, the invitation, the feedback questions, what Lablo collects while they test, and Omar's checklist. PLAN.md's phase 11: "Closed beta (10–30 users in GCC and North America), then LG and Samsung US submissions". The beta itself, the testers and the store accounts are Omar's (step 46).

Sources: LG's and Samsung's own pages, read on 2026-11-26. Every quote is copied from the page it links to. A claim marked **(unconfirmed)** comes from somewhere other than LG's or Samsung's own pages, or could not be read there.

## How testers get a build

### What this means for Lablo (summary)
| | Through the store | Developer Mode on the tester's TV |
|---|---|---|
| **Samsung** | **Beta Test** in Seller Office: activation codes, up to 90 days, only on 2021 and newer TVs, only in the app's service countries. A Public Seller launches only in the US, so GCC testers need the Partner contract first. | A `.wgt` signed with a distributor certificate that lists each TV's DUID (up to 50), installed from a PC on the same network. Works on 2020 TVs too (Lablo's Samsung minimum, ADR-015). |
| **LG** | **Alpha Test** in Seller Lounge: up to 100 TVs by wired MAC address, up to 30 days. Only for sellers with a separate commercial contract. | An `.ipk` installed with the webOS CLI from a PC; the tester signs in to the Developer Mode app with an LG Developer account; the session runs for a limited time. |

**The likely mix for a 10–30 person beta while Lablo has no partner contract with either brand:**
- **Samsung, US testers with a 2021 or newer TV:** the store's Beta Test (if Seller Office offers it to a Public Seller; its pages neither say yes nor no).
- **Samsung, GCC testers or a 2020 TV:** Developer Mode, with Omar or a helper at the TV with a laptop (the DUID goes into our certificate first).
- **LG, everyone:** Developer Mode, the same way, unless LG grants Alpha Test after a partnership request (Seller Lounge › 1:1 Q&A › Partnership › Business Partnership).

So a GCC beta is mostly hands-on installs, which suits a small group of people Omar can reach. Which route and how many testers per route is Omar's call at step 46.

### Samsung: the store's Beta Test
Seller Office › Applications › Distribute › "Create Beta Test".
- **Before it:** "The application information except 'Verification Info' must be fully entered before beta testing can begin." The build need not be certified or released: "You can choose from a version that has not yet been released on TV or has not been requested to be released." ([Distributing an application](https://developer.samsung.com/tv-seller-office/guides/applications/distributing-application.html))
- **Review:** "Samsung's verification test is not performed. However, after registering beta test information, you must obtain approval from Samsung Content Manager" ([Beta test FAQ](https://developer.samsung.com/tv-seller-office/faq/beta-test.html))
- **TVs:** "Beta testing is available starting from Smart TVs released in 2021." ([Beta test FAQ](https://developer.samsung.com/tv-seller-office/faq/beta-test.html)) The 2020 test Samsung (UA32T5300) and every other 2020 TV cannot join.
- **Countries:** "beta testing is only available in the service country of the application." ([Beta test FAQ](https://developer.samsung.com/tv-seller-office/faq/beta-test.html)) And "Public Sellers can only launch in the US." ([Entering application information](https://developer.samsung.com/tv-seller-office/guides/applications/entering-application-information.html)) To become a Partner, "you need to sign an offline contract with Samsung HQ or a local subsidiary" ([Becoming a Seller Office member](https://developer.samsung.com/tv-seller-office/guides/membership/becoming-seller-office-member.html)): the Samsung Gulf application on Omar's list.
- **Testers:** by activation code, not by email: "you can only install beta on a TV that is certified with the beta test activation code" and "one activation code is used as a one-time" ([Beta test FAQ](https://developer.samsung.com/tv-seller-office/faq/beta-test.html)). Codes come as a CSV. "You can issue up to 1000 activation codes" ([Distributing](https://developer.samsung.com/tv-seller-office/guides/applications/distributing-application.html)); the FAQ also says "Up to 100,000 additional activation codes can be issued." Either way, far more than we need.
- **Recruiting and feedback are ours:** "Application development company should recruit beta testers on their own and provide a path to receive feedback." ([Beta test FAQ](https://developer.samsung.com/tv-seller-office/faq/beta-test.html))
- **How long:** "Test start and end dates can be set up to a maximum of 90 days." ([Distributing](https://developer.samsung.com/tv-seller-office/guides/applications/distributing-application.html)); it can be extended "to up to 180 days per test" ([Beta test FAQ](https://developer.samsung.com/tv-seller-office/faq/beta-test.html)).
- **On the tester's TV:** "On the TV's Settings screen, enter the hidden key "134678" with the remote to display the activation code input window." The tester agrees to our precautions, then installs. A newer beta build is "automatically updated to the latest version". At the end, "If there is no normal version, the beta application will be deleted." ([Distributing](https://developer.samsung.com/tv-seller-office/guides/applications/distributing-application.html))
- **A beta build is not the release:** "You cannot submit a version submitted for a beta or alpha test as a release version." ([Distributing](https://developer.samsung.com/tv-seller-office/guides/applications/distributing-application.html)) Step 47 submits its own build.
- **Alpha Test** (for comparison) is for Partners only: "this alpha testing service is exclusively available to partner sellers." ([Distributing](https://developer.samsung.com/tv-seller-office/guides/applications/distributing-application.html))

### Samsung: Developer Mode and a signed `.wgt`
- **Our certificate names each TV:** "Define the privilege level you need, and add the device ID (DUID) for the target device." ([Creating certificates](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html)) "You can add up to 50 DUIDs." ([Creating a certificate](https://developer.samsung.com/tizen/certificate-signing/creating-certificate.html); a general Tizen page, not a TV one.) Our certificate is made and kept off the repo; `docs/runbooks/tv-setup.md` §3.2 has the steps.
- **The tester's DUID:** "Menu > Support > Contact Samsung > Unique Device ID" ([Creating certificates](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html)). "The reset changes the DUID." ([Device information FAQ](https://developer.samsung.com/smarttv/develop/faq/device-information-and-firmware.html)): a factory reset needs a newly signed build.
- **At the TV:** Smart Hub › Apps › "App Settings", where you "enter "12345" using the remote control", then the PC's IP address, and "Connect your computer and the TV to the same network." ([TV device](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html)) Then `pnpm device install tizen <serial>` from our laptop (tv-setup.md §3.3).
- **No USB route:** `.wgt` application package files "cannot be installed on a TV through USB." ([Installation FAQ](https://developer.samsung.com/smarttv/develop/faq/application-installation.html))
- Samsung's pages say nothing for or against handing such a build to outside testers.

### LG: the store's Alpha Test
Seller Lounge › Applications › Alpha Test.
- **What it is:** "you can release the test version of your application on specific TVs before officially displaying it on Apps" ([Alpha Test guide](https://seller.lgappstv.com/seller/support/userGuide/RetrieveUserGuide.lge?pstgSeq=23)).
- **Who may use it:** "This feature will only be opened to sellers that have entered a separate commercial contract for the time being for stabilization." ([Alpha Test guide](https://seller.lgappstv.com/seller/support/userGuide/RetrieveUserGuide.lge?pstgSeq=23)) The FAQ: "the service is available only to the users with certain authority" ([Seller Lounge FAQ](https://seller.lgappstv.com/seller/support/faq/RetrieveFaq.lge)), and a partnership is asked for through 1:1 Q&A › Partnership.
- **Testers are TVs:** "You can register 100 TVs at the most." "It functions based on MAC Address, so you must accurately input the Wired MAC Address." "The maximum period is 30 days from the beginning of the test." "Alpha test is supported on webOS 3.0 (2016 model) and later platforms." On the TV it shows under "Newly Updated Apps". ([Alpha Test guide](https://seller.lgappstv.com/seller/support/userGuide/RetrieveUserGuide.lge?pstgSeq=23))

### LG: Developer Mode and an `.ipk`
- **The tester's account:** "The Developer Mode app requires you to sign in to the LG Developer site." ([Developer Mode app](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app)) Each tester signs in with an LG Developer account of their own; per LG's forum, one account keeps only the latest TV's session **(unconfirmed: [forum](https://forum.webostv.developer.lge.com/t/6428))**.
- **How long:** "Developer Mode enables for a limited time." It is extended with the app's EXTEND button while the TV is online; "If the session time runs out, you cannot extend the session time," and then the "installed apps that you were using on Developer Mode are uninstalled". ([Developer Mode app](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app)) LG's forum gives the session as 1,000 hours, about 41 days **(unconfirmed: [forum](https://forum.webostv.developer.lge.com/t/28033))**: enough for a two-week beta if the tester extends it once.
- **Installing:** `pnpm device install webos <device>` from a laptop on the same network (tv-setup.md §2); our test LG is set up this way.
- LG's pages say nothing for or against handing such a build to outside testers.

### What both stores' reviewers will need later (step 47)
Not the beta, but the same accounts: Samsung wants "at least 1 test account for each model group that your application supports" ([Entering application information](https://developer.samsung.com/tv-seller-office/guides/applications/entering-application-information.html)) and warns "Do not submit an application that accesses only test servers." ([Certification FAQ](https://developer.samsung.com/tv-seller-office/faq/certification-process.html)). LG's form has "Test Account/Password / Voucher Code" ([Enter your app info](https://seller.lgappstv.com/seller/support/userGuide/RetrieveUserGuide.lge?pstgSeq=22)) and its QA takes "average 2~3 weeks" ([Seller Lounge FAQ](https://seller.lgappstv.com/seller/support/faq/RetrieveFaq.lge)). Both come from `test-server.md` and `samsung-tester-notes.md`.

## What Lablo collects during the beta
The beta build is the app as it ships: nothing extra is collected for the beta. Three things can leave a tester's TV, each described in the privacy draft (`packages/protocol/src/legal.ts`, step 40d), and all of them need the production server (step 34, see the checklist).

**1. Usage and crash reports** (step 33b; on by default, Settings › "Usage and crash reports" turns them off; kept 90 days). A batch carries a random install ID (made on the TV at first use; a wipe, or turning the reports off and on, gives a new one), the platform (`tizen` or `webos`) and the app version. The events (`packages/protocol/src/telemetry.ts`):

| Event | When | What it holds |
|---|---|---|
| `app_start` | each start | the device tier (low/full), the cold start in ms, the catalog's size as a bucket |
| `capability` | once per app or firmware change | the TV's model and firmware as the TV names them, the Chromium version, the feature probes (yes/no or a number) |
| `ingest_done` | each playlist or guide refresh | the kind (Xtream, M3U, guide), how long it took, its size and item count as buckets |
| `epg_match` | after a guide refresh | the share of channels with a guide, as a bucket |
| `play_result` | each play | the engine (AVPlay, HTML5, MSE), the container (TS, HLS, MP4, MKV, other), live/VOD/catch-up, the time to the first frame, and on a failure its kind (network, HTTP, timeout, stall, unsupported, decode, app), its code and HTTP status |
| `stall` | each stall | whether it recovered, and after how many tries |
| `crash` | an uncaught error | where (the app or a worker) and the message and stack, after the scrubber removed links and logins (at most 4,000 characters) |

Never in an event: a link or a server's name, a channel, movie or series name, a login, an IP address. The server checks every event against its schema and drops fields it does not know. The remote config can sample each kind (`tunables.telemetrySampling`); with none set, every event is kept, which is what the beta wants.

**2. The report to support** (step 33d; only when the tester picks Settings › "Send a report to support"; kept 30 days). The TV's model, the app's state and recent errors, with no install ID, no links and no logins. The TV shows a 6-character support code; the tester sends that code to support with what happened, and the report is found by it (`DiagReport.code`).

**3. The encrypted backup and the phone pairing** (steps 31 and 32), as in any install: the server holds only ciphertext it cannot read. Nothing about them is beta-specific.

**Reading it** (read-only, once step 34's database exists; the table names are Prisma's defaults from `apps/web/prisma/schema.prisma`, not yet run against production):

```sql
-- Plays and failures by platform and kind of failure, for the beta's version.
select platform, data->'error'->>'kind' as failure, count(*)
from "TelemetryEvent"
where kind = 'play_result' and "appVersion" = '<beta version>'
group by 1, 2 order by 3 desc;

-- Which TVs took part (one row per install and model).
select distinct "installId", data->>'model' as model, data->>'firmware' as firmware, platform
from "TelemetryEvent"
where kind = 'capability' and "appVersion" = '<beta version>';

-- A tester's report, by the code they sent.
select report from "DiagReport" where code = '<CODE>';
```

## The invitation
Send it from the support address (`lablo.iptv@gmail.com`) or Omar's own. Fill the braces; keep "Lablo provides no content" and the line about links and logins in every copy. The Arabic text needs the native read of step 46 before it goes out.

### English
> **Subject:** Try Lablo on your TV before it launches
>
> Hi {name},
>
> We're building Lablo, a free player for your own IPTV playlist on Samsung and LG smart TVs, in Arabic and English. Before it goes into the stores, we're looking for {number} people to use it on their own TV for two weeks and tell us what works and what doesn't.
>
> **You'll need:**
> - A Samsung smart TV from 2020 or newer (Tizen 5.5 or later), or an LG smart TV from 2020 or newer (webOS 5 or later). Please send us its model: it's on a label on the back, or in the TV's settings under "About this TV".
> - Your own IPTV subscription: an M3U link or an Xtream login from a service you have the right to watch. Lablo provides no channels, playlists or subscriptions. We will never ask for your link or login, and you should never send them to us.
> - A short install (we'll send the steps for your TV, and for some TVs we install it with you), two weeks of normal use, and 10 minutes for a short form at the end.
>
> **How you'll get it:** {the steps for the tester's TV, from "How testers get a build"}.
>
> **What the test version sends:** anonymous usage and crash reports: the app version and kind of TV, how often playback starts, stalls or fails (as rough counts), and the kind of error. Never your links, logins or channel names. You can turn them off in Settings › "Usage and crash reports". If something goes wrong, Settings › "Send a report to support" gives you a short code: send it to lablo.iptv@gmail.com with what happened.
>
> It's a test version, so expect some rough edges. When Lablo is in your TV's app store, install that one instead.
>
> If you're in, reply with your TV's model and whether you'd like to use Lablo in Arabic or English.
>
> Thank you,
> {sender}

### العربية (مسودة؛ تحتاج مراجعة متحدث أصلي في الخطوة 46)
> **الموضوع:** جرّب لابلو على تلفازك قبل إطلاقه
>
> مرحباً {الاسم}،
>
> نعمل على لابلو، وهو مشغّل مجاني لقائمة IPTV الخاصة بك على تلفزيونات سامسونج وإل جي الذكية، بالعربية والإنجليزية. قبل وصوله إلى المتاجر، نبحث عن {العدد} أشخاص يستخدمونه على تلفازهم مدة أسبوعين ويخبروننا بما يعمل وما لا يعمل.
>
> **ستحتاج إلى:**
> - تلفاز سامسونج ذكي من عام 2020 أو أحدث (Tizen 5.5 أو أحدث)، أو تلفاز إل جي ذكي من عام 2020 أو أحدث (webOS 5 أو أحدث). أرسل لنا طرازه: تجده على ملصق خلف التلفاز، أو في إعدادات التلفاز تحت «حول هذا التلفاز».
> - اشتراك IPTV خاص بك: رابط M3U أو بيانات دخول Xtream من خدمة لك الحق في مشاهدتها. لابلو لا يقدّم أي قنوات أو قوائم أو اشتراكات. لن نطلب منك رابطك أو بيانات دخولك أبداً، ولا ترسلها إلينا.
> - تثبيت قصير (نرسل لك خطوات تلفازك، ولبعض التلفزيونات نثبّته معك)، ثم استخدام عادي لمدة أسبوعين، و10 دقائق لاستبيان قصير في النهاية.
>
> **كيف تحصل عليه:** {خطوات التثبيت لتلفاز المختبِر، من قسم "How testers get a build"}.
>
> **ما ترسله النسخة التجريبية:** تقارير استخدام وأعطال مجهولة الهوية: إصدار التطبيق ونوع التلفاز، وكم مرة يبدأ التشغيل أو يتوقف أو يفشل (بأرقام تقريبية)، ونوع الخطأ. لا تتضمن أبداً روابطك أو بيانات دخولك أو أسماء قنواتك. يمكنك إيقافها من الإعدادات › «تقارير الاستخدام والأعطال». وإذا حدثت مشكلة، يعطيك «إرسال تقرير إلى الدعم» في الإعدادات رمزاً قصيراً: أرسله إلى lablo.iptv@gmail.com مع وصف ما حدث.
>
> هذه نسخة تجريبية، فقد تواجه بعض الأخطاء. عندما يصل لابلو إلى متجر تطبيقات تلفازك، ثبّت تلك النسخة بدلاً منها.
>
> إذا كنت مهتماً، أرسل لنا طراز تلفازك، واللغة التي تفضّل استخدام لابلو بها: العربية أو الإنجليزية.
>
> شكراً لك،
> {المرسِل}

## The feedback questions
For a form Omar makes (any form tool; the answers are his, not the repo's). Ask them at the end of the two weeks, in the tester's language. Put this line at the top of the form: "Never write your M3U link, server address, username or password in this form."

**About your TV and your playlist**
1. Your TV: brand, model and year.
2. The language you used Lablo in: Arabic or English.
3. Your playlist: an Xtream login, an M3U link, or both. Roughly how many live channels: under 1,000, 1,000 to 10,000, over 10,000.
4. The country you watched from.

**Setting up**
5. How you added your playlist: from your phone (the code on the screen), by typing on the TV, or both.
6. How easy was it to set up? (1 very hard to 5 very easy.) What was hard?
7. If you typed on the TV: did Lablo's own keyboard work for you (Arabic and English letters, the caret, the field moving above the keyboard)? (1 to 5.) Did you use the key that switches to your TV's keyboard?

**Watching**
8. Live channels: how quickly did a channel start? (Under 2 seconds, 2 to 5, over 5.) Did Lablo open on your last channel when you started it?
9. Did a channel or a movie fail to play in Lablo that plays in another app on the same TV? If so: live, movie or series, and what the error card said (its title and the code under it). Please don't send the channel's name or link.
10. Freezes: how often did the picture freeze? Did "Reconnecting…" show, and did it come back by itself?
11. The guide: did most of your channels have programmes in it? Did catch-up play, if your provider has it?
12. Movies and series: posters, resuming where you stopped, the next episode: anything wrong?

**Arabic and reading** (Arabic testers)
13. Did any Arabic text read wrong, run the wrong way, sit on the wrong side, or get cut off? Which screen, and what did it say?
14. Were the words natural? Any you'd change?

**Overall**
15. What would stop you using Lablo every day?
16. If we could fix one thing first, what should it be?
17. Overall, how was Lablo? (1 to 5.) How likely are you to recommend it to a friend? (0 to 10.)
18. The support codes of any reports you sent.
19. May we write to you about your answers? (Your email, if yes.)

## Omar's checklist
**Before the invitations go out**
- [ ] **Step 34 is live:** the production API is set in `tv-defines.config.ts` (`PRODUCTION_API_BASE`). Until then every build asks `http://127.0.0.1:3100`: on a tester's TV there is no remote config, no usage report, no support report, no backup and no phone pairing (the app still plays).
- [ ] **The beta's version** in `apps/tv/package.json` (not 0.0.0; `release:check` refuses it), the same in the form and in the SQL above.
- [ ] **The route per store** chosen from "How testers get a build", and the beta builds made and installed on our own two TVs first (the LG and the Samsung).
- [ ] **Samsung's store Beta Test** (US testers, 2021 and newer TVs): the app's information in Seller Office filled except "Verification Info" (the listing and screenshots of step 44), the beta created, Samsung Content Manager's approval, our precautions text written, and one activation code per tester. Its build is never the release build (step 47 uploads its own).
- [ ] **Developer Mode testers:** each Samsung TV's DUID added to our distributor certificate and the build signed again (a factory reset changes the DUID); each LG tester's own LG Developer account; one laptop visit or call per install, and on LG a reminder to press EXTEND before the session runs out.
- [ ] **The legal text:** a store beta needs a store build, and `build:tv --release` refuses while the draft mark is on (counsel's text, step 40d). A Developer Mode build carries the "Draft for counsel" mark; tell testers that the terms are a draft.
- [ ] **The remote config's sampling** (`tunables.telemetrySampling`) unset or 1 for every kind while the beta runs.
- [ ] **Testers:** 10 to 30, in the GCC and North America; both brands; TV years spread from 2020 (both brands) to now, at least one 2020 Samsung among them; at least five who read Arabic natively (one of them also does step 46's read of `listing-ar.md` and this invitation); every one with their own provider.
- [ ] **The form** made from the questions above, in English and Arabic, and its link added to the invitation.
- [ ] **The support inbox** (`lablo.iptv@gmail.com`) watched daily during the beta.

**During the two weeks**
- [ ] Each support code looked up (`DiagReport`) and answered.
- [ ] A look at the numbers twice a week (the SQL above): failures by kind, stalls recovered or not, which TVs took part.
- [ ] Any fix shipped as a new beta build, its version raised.

**After**
- [ ] The answers and the numbers turned into relay steps (one line each, with the tester's TV and the support code), before step 47's submissions.
- [ ] Testers told when Lablo is in the stores, and asked to move to the store version.
