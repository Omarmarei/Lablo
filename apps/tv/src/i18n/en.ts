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
} as const;

export type MessageKey = keyof typeof EN;
