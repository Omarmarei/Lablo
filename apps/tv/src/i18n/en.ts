/**
 * The English catalog: the source of every UI string and the fallback (RELAY step 12, ADR-011).
 * Messages use the ICU subset in `@zoma/ui`'s message.ts: `{name}`, `{n, plural, …}` with `#`,
 * `{x, select, …}`. Keys are `area.what`. ar.ts must have the same keys (tsc) with the same
 * arguments, and its plurals must give all six Arabic forms (`catalogs.test.ts`).
 */
export const EN = {
  // The component gallery (?screen=gallery).
  'gallery.title': 'Components',
  'gallery.channelCount': '{n, plural, one {# channel} other {# channels}}',
  'gallery.selected': 'Selected: {what}',
  'gallery.pressOk': 'Press OK on any item',
  'gallery.continueWatching': 'Continue watching',
  'gallery.status': 'Progress and status',
  'gallery.loading': 'Loading channels',
  'gallery.guideUpdated': 'Guide updated',
  'gallery.timeline': 'Media timeline',
  'gallery.playMessage': 'Playback arrives with the player. This is the Dialog component.',

  // Actions.
  'action.play': 'Play',
  'action.favourite': 'Add to favourites',
  'action.removeSource': 'Remove source',
  'action.record': 'Record',
  'action.cancel': 'Cancel',

  // Channel categories of our own (a provider's category names are its data).
  'category.all': 'All channels',
  'category.favourites': 'Favourites',
  'category.sports': 'Sports',
  'category.news': 'News',
  'category.movies': 'Movies',
  'category.kids': 'Kids',
  'category.documentaries': 'Documentaries',
  'category.music': 'Music',
  'category.radio': 'Radio',

  // The guide.
  'guide.next': 'Next',
  'guide.none': 'No guide for this channel',

  // Badges.
  'badge.live': 'LIVE',
  'badge.new': 'NEW',
  'badge.catchUp': 'Catch-up',
  'badge.expires': '{days, plural, =0 {Expires today} one {Expires in # day} other {Expires in # days}}',

  // Dialogs.
  'play.title': 'Play {name}?',
  'exit.title': 'Exit Zoma?',
  'exit.message': 'You can come back any time.',
  'exit.stay': 'Stay',
  'exit.confirm': 'Exit',

  // The app's name, in each language's script.
  'app.name': 'Zoma',

  // Onboarding (RELAY step 13): the first start. Brand and format names (Xtream, M3U, XMLTV,
  // http://) are arguments, so they are isolated and the Arabic holds no Latin of its own.
  'onboarding.chooseLanguage': 'Choose your language',
  'onboarding.disclaimerTitle': 'Zoma is a player',
  'onboarding.disclaimerBody': 'Zoma provides no channels, films or other content, and it is not linked to any provider.',
  'onboarding.disclaimerAdd': 'To watch, add a playlist or a login from a provider you have the right to use. You are responsible for what you add.',
  'onboarding.understand': 'I understand',
  'onboarding.consentTitle': "Use this TV's ID for your backup?",
  'onboarding.consentBody':
    "Zoma can use this TV's device ID to encrypt a backup of your sources and favourites, so they come back after an app update or a reset. The ID itself never leaves your TV.",
  'onboarding.backupNote':
    "The backup is on by default and is encrypted on your TV before it is sent, so we can't read it. You can turn it off, or leave out your login details, in Settings.",
  'onboarding.consentNo': "If you don't allow it, Settings shows a backup code for you to note down instead.",
  'onboarding.allow': 'Allow',
  'onboarding.notNow': 'Not now',
  'onboarding.sourceTitle': 'Add your source',
  'onboarding.sourceBody': 'Use the details your provider gave you. Zoma comes with no sources of its own.',
  'onboarding.xtream': '{name} login',
  'onboarding.xtreamHint': 'A server address, a username and a password',
  'onboarding.m3u': '{format} playlist link',
  'onboarding.m3uHint': 'A link to a playlist file',
  'onboarding.typeHint': 'Press OK on a field to type, and OK again when you are done.',
  'onboarding.add': 'Add source',

  // The source form's fields.
  'field.server': 'Server address',
  'field.serverHint': 'As your provider sent it. {scheme} is added if you leave it out.',
  'field.username': 'Username',
  'field.password': 'Password',
  'field.playlist': 'Playlist link',
  'field.linkHint': 'Starts with {http} or {https}',
  'field.epg': 'Guide link (optional)',
  'field.epgHint': 'An {format} link, if your provider gave you one',
  'field.name': 'Name (optional)',
  'field.nameHint': 'Shown in your list of sources',
  'field.required': 'Fill this in',
  'field.url': 'Enter a link that starts with {http} or {https}',
  'field.spaces': "A link can't contain spaces",

  // Adding a source.
  'loading.title': 'Adding {name}',
  'loading.checking': 'Checking the details',
  'loading.download': 'Loading: {n, plural, one {# item} other {# items}}',
  'loading.saving': 'Saving',
  'loading.guide': 'Loading the guide',
  'loading.failed': "Couldn't add {name}",
  'loading.edit': 'Edit details',
  'loading.retry': 'Try again',

  // Why a source couldn't be added.
  'error.auth': "The provider didn't accept this username and password.",
  'error.expired': 'This account has expired. Contact your provider.',
  'error.blocked': 'Your provider has blocked or turned off this account. Contact your provider.',
  'error.network': "Couldn't reach the server. Check the address and your internet connection.",
  'error.http': 'The server answered with error {status, number}.',
  'error.format': "This link didn't give a playlist.",
  'error.empty': 'The playlist has no channels.',
  'error.other': 'Something went wrong. Try again.',

  // The source is added.
  'done.title': "You're all set",
  'done.body': '{name} is ready.',
  'done.live': '{n, plural, one {# channel} other {# channels}}',
  'done.movies': '{n, plural, one {# film} other {# films}}',
  'done.series': '{n, plural, one {# series} other {# series}}',
  'done.start': 'Start watching',

  // The live screen (RELAY step 14a). A provider's category names are its data.
  'live.title': 'Live TV',
  'live.channels': '{n, plural, one {# channel} other {# channels}}',
  'live.noGroup': 'Other channels',
  'live.loading': 'Loading your channels',
  'live.empty': 'Your sources have no live channels.',
  'live.failed': "Couldn't read your channels.",
  'live.retry': 'Try again',
  'badge.radio': 'Radio',

  // The player (RELAY step 20a). Codes are data (PRV-HTTP-404): they stay as they are.
  'player.connecting': 'Connecting…',
  'player.reconnecting': 'Reconnecting…',
  'player.previous': 'Previous channel',
  'player.noChannel': 'No channel {number}',
  'player.retry': 'Try again',
  'player.channels': 'Channels',
  'player.code': 'Code {code}',
  'player.internet.title': 'No internet connection',
  'player.internet.advice': 'Check that the TV is connected to the internet, then try again.',
  'player.provider.title': "Your provider isn't sending this channel",
  'player.provider.advice': "The problem is on the provider's side. Try again later, or contact your provider.",
  'player.device.title': "This TV can't play this channel",
  'player.device.advice': "The channel uses a format this TV doesn't support. Try another channel.",
  'player.app.title': 'Something went wrong in Zoma',
  'player.app.advice': 'Try again. If it keeps happening, restart the app.',
  'player.account.refused': "Your provider didn't accept the login. Check the username and password.",
  'player.account.expired': 'Your subscription with this provider has expired.',
  'player.account.blocked': 'Your provider has blocked or turned off this account.',
  'player.account.full': 'Your account is already watching on other screens.',
  'player.account.expiry': 'Subscription ends {date}',
  'player.account.connections': 'Connections in use: {active, number} of {max, number}',
  'player.tracks': 'Audio and subtitles',
  // The stream info (RELAY step 20c2a): technical names (codecs, formats) are shown as they are.
  'player.streamInfo': 'Stream info',
  'player.info.waiting': 'Waiting for the picture…',
  'player.info.resolution': 'Resolution',
  'player.info.frameRate': 'Frame rate',
  'player.info.bitrate': 'Bitrate',
  'player.info.video': 'Video',
  'player.info.audio': 'Audio',
  'player.info.format': 'Format',
  'player.info.engine': 'Player',
  'player.info.dropped': 'Dropped frames',
  'player.info.fps': '{fps, number} fps',
  'player.info.mbps': '{value, number} Mb/s',
  'player.info.kbps': '{value, number} kb/s',

  // The track menu (RELAY step 20b).
  'tracks.audio': 'Audio',
  'tracks.subtitles': 'Subtitles',
  'tracks.off': 'Off',
  'tracks.unsupported': 'Not supported on this TV',
  'tracks.none': 'None in this stream',
  'tracks.refused': "The TV didn't switch to it. Try again.",
  'tracks.track': 'Track {n, number}',
  // Subtitle files and the subtitle style (RELAY step 20b2b).
  'tracks.file': 'File',
  'tracks.fileFailed': "This subtitle file couldn't be loaded.",
  'tracks.style': 'Subtitle style',
  'tracks.styleHint': 'Press left or right to change',
  'tracks.size': 'Size',
  'tracks.size.s': 'Small',
  'tracks.size.m': 'Medium',
  'tracks.size.l': 'Large',
  'tracks.timing': 'Timing',
  'tracks.timing.none': 'No delay',
  'tracks.timing.later': '{seconds, number} s later',
  'tracks.timing.earlier': '{seconds, number} s earlier',

  // Language names, for audio and subtitle tracks.
  'lang.ar': 'Arabic',
  'lang.en': 'English',
  'lang.fr': 'French',
  'lang.es': 'Spanish',
  'lang.de': 'German',
  'lang.it': 'Italian',
  'lang.pt': 'Portuguese',
  'lang.ru': 'Russian',
  'lang.tr': 'Turkish',
  'lang.fa': 'Persian',
  'lang.ur': 'Urdu',
  'lang.hi': 'Hindi',
  'lang.zh': 'Chinese',
  'lang.ja': 'Japanese',
  'lang.ko': 'Korean',
  'lang.bn': 'Bengali',
  'lang.ta': 'Tamil',
  'lang.ml': 'Malayalam',
  'lang.tl': 'Filipino',
  'lang.ku': 'Kurdish',
} as const;

export type MessageKey = keyof typeof EN;
