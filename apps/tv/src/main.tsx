import { computed, signal } from '@preact/signals';
import { render } from 'preact';
import type { CatalogItem, ContentKey, DeviceTier } from '@lablo/core';
import { normalizeLang } from '@lablo/core';
import type { BackupCallRequest, DiagSendResult, LastChannel, LoadedProfile } from '@lablo/data';
import type { Language, Navigator } from '@lablo/ui';
import { Spinner } from '@lablo/ui';
import { backupRequest, consentOf } from './backup/backup-request';
import { createBackupSchedule } from './backup/backup-schedule';
import { createBackupStart } from './backup/backup-start';
import { BackupStartApp } from './backup/BackupStartApp';
import { lookupRequest } from './backup/lookup-request';
import { createConfigSchedule } from './data/config-schedule';
import type { DataEngine, SourceFacts } from './data/engine';
import { readApiBase, readRestored, readScreen, restartUrl } from './data/params';
import type { RefreshScheduler } from './data/refresh-scheduler';
import { createRefreshScheduler } from './data/refresh-scheduler';
import { createLazyFile } from './lazy/lazy-file';
import type { LoadedSettings } from './settings/settings';
import type { SettingsOptions } from './settings/settings-state';
import { createAppDataEngine } from './data/workers';
import { appI18n } from './i18n';
import { showDevScreen } from './dev/dev-screens';
import { GateApp } from './gate/GateApp';
import { createGate, noticesShownOf, refusalFor } from './gate/gate-state';
import { LiveApp } from './live/LiveApp';
import type { Live } from './live/live-state';
import { createLive } from './live/live-state';
import type { Guide } from './guide/guide-state';
import { createGuide, guideFromPlayer } from './guide/guide-state';
import { createFavouriteMenu } from './player/favourite-menu';
import type { Movies } from './movies/movies-state';
import { createMovies, selectSeries } from './movies/movies-state';
import { episodePlay } from './shows/episode-play';
import { createShowDetails } from './shows/show-details';
import { createMovieDetails, movieFacts, movieRequest } from './movies/movie-details';
import type { ResumePoint } from './movies/movie-progress';
import { createMovieProgress } from './movies/movie-progress';
import type { Search } from './search/search-state';
import { createSearch } from './search/search-state';
import type { Home } from './home/home-state';
import { createHome } from './home/home-state';
import { createEngineLoader } from './onboarding/engine-loader';
import type { SourceDraft } from './onboarding/form';
import type { LoadResult, SourceLoader } from './onboarding/loader';
import { OnboardingApp } from './onboarding/OnboardingApp';
import type { Onboarding } from './onboarding/onboarding-state';
import type { Pairing } from './pairing/pair-state';
import { createPairing } from './pairing/pair-state';
import { appPlayer, trackPreferences } from './player/app-player';
import { catchupRequest } from './player/catchup';
import { createPlayerMemory, railRefOf } from './player/player-memory';
import type { Player } from './player/player-state';
import { createPlayer } from './player/player-state';
import { createStage, setPlayerChrome } from './player/stage';
import { createOnboarding } from './onboarding/onboarding-state';
import type { LifecycleSource } from './parental/parental';
import { createParental } from './parental/parental';
import { answerEdit, readStartProfile, startPoint } from './onboarding/start';
import { createPlatform } from './platform';
import { createCrashReporter, listenForCrashes } from './telemetry/crash-state';
import { appStartEvent, capabilityEvent, deviceProbes, diagParts } from './telemetry/telemetry-events';
import { createTelemetry, telemetryOn } from './telemetry/telemetry-state';
import { playerEvent, recordRefresh } from './telemetry/usage-events';
import { installTestHook } from './test-hook';

/**
 * What the player keeps in the profile (RELAY step 20c1): filled from the start's profile, written
 * through the data engine (made by then: only a play writes).
 */
const memory = createPlayerMemory({ edit: (edit) => dataEngine().editProfile(edit) });
/** Where each movie was left (RELAY step 26d): filled from the start's profile, saved by the player. */
const progress = createMovieProgress({ edit: (edit) => dataEngine().editProfile(edit) });
const platform = createPlatform({ redirects: memory.redirects });
platform.registerKeys();
/** The device's tier once the platform says it (the guide's days). */
let tier: DeviceTier = 'full';
// tokens.css turns motion off on the low tier (`?tier=low` forces it in the browser).
void platform.info().then(
  (info) => {
    tier = info.tier;
    document.documentElement.setAttribute('data-tier', info.tier);
  },
  () => undefined,
);

const root = document.getElementById('app');
if (root === null) throw new Error('#app element missing from index.html');

/**
 * Each source's facts (`DataEngine.sourceFacts`), read when the live screen opens and after a
 * catalog refresh: an Xtream account's `allowed_output_formats` (RELAY step 20c2a; until they are
 * read, the start's last channel tries every format, the one that played first) and the panel's
 * zone for catch-up (step 25a).
 */
let sourceFacts = new Map<string, SourceFacts>();

/** Remote keys are being pressed (a running refresh pauses). */
const busy = signal(false);
let engine: DataEngine | null = null;

/** The data engine, started once and shared by every screen. */
function dataEngine(): DataEngine {
  if (engine === null) {
    engine = createAppDataEngine({
      onBusy: (value) => {
        busy.value = value;
      },
      // The backup's upload follows every change (step 32c2).
      onProfileChanged: () => backup.changed(),
      // Telemetry's `ingest_done` and `epg_match` (step 33b2).
      onRefreshed: (done) => void recordRefresh(done, dataEngine(), (event) => telemetry.record(event), Date.now),
      // Telemetry's `crash` for a worker's uncaught error (step 33c).
      onWorkerError: (error) => crashes.worker(error),
    });
  }
  return engine;
}

/**
 * This build's config request (tv-defines.config.ts). `?api=` (step 30c1) points it at a test's
 * server: any origin in the desktop dev app, only this device's in a TV build.
 */
const configRequest = {
  base: readApiBase(location.search, __API_BASE__, __PLATFORM__ === 'browser'),
  platform: __PLATFORM__,
  version: __APP_VERSION__,
  keys: __CONFIG_KEYS__,
};

/** The build's half of the backup's scrypt salt (step 32b): never changes once a TV has a backup. */
const BACKUP_BUILD = { platform: __PLATFORM__, appId: __APP_ID__ };

/**
 * The backup worker's request for an upload or Settings' backup page: the profile's consent read
 * afresh, the device ID only after "Allow" (`backupRequest`), else the backup code.
 */
function backupCall(): Promise<BackupCallRequest> {
  return dataEngine()
    .profile()
    .then((profile) => backupRequest(platform, consentOf(profile), BACKUP_BUILD))
    .then((prepared) => ({ platform: prepared.platform, appId: prepared.appId, secret: prepared.secret, base: configRequest.base }));
}

/**
 * The backup's upload (RELAY step 32c2): 60 s after a profile change, at most every 5 minutes, at
 * once when the app is hidden, from the live screen on; "Replace it" from Settings (step 32d2b).
 */
const backup = createBackupSchedule({
  engine: {
    uploadBackup: (request) => dataEngine().uploadBackup(request),
    replaceHeldBackup: (request) => dataEngine().replaceHeldBackup(request),
  },
  request: backupCall,
  lifecycle: (listener) => platform.onLifecycle(listener),
});
/** The look-up at a start with no profile is running (step 32c2): its backup worker may be in the database. */
let lookingUp = false;

/**
 * The signed config (RELAY step 30b2): a config worker after the start's first paint and then
 * every 6 h, never waited for; its policy (`config.policy`) is enforced from step 30c.
 */
const config = createConfigSchedule({
  engine: { refreshConfig: (request, onCached) => dataEngine().refreshConfig(request, onCached) },
  request: configRequest,
  lifecycle: (listener) => platform.onLifecycle(listener),
});

/**
 * The config's rules inside the app (RELAY step 30c2b): `block-new-sources` refuses onboarding's
 * new source, `disable-playback` every play (and stops one playing); stronger rules do as well.
 */
/**
 * Telemetry (RELAY step 33b1): events recorded in memory, sent by a telemetry worker 60 s after the
 * first one not yet sent, at most every 15 minutes, and when the app is hidden, from the live screen
 * on; the backup's API base, the config's sampling.
 */
const telemetry = createTelemetry({
  engine: { sendTelemetry: (request) => dataEngine().sendTelemetry(request) },
  request: () => ({ base: configRequest.base, platform: __PLATFORM__, appVersion: __APP_VERSION__, sampling: config.policy.value.tunables.telemetrySampling ?? null }),
  lifecycle: (listener) => platform.onLifecycle(listener),
});

/**
 * The diagnostics report (RELAY step 33d2), sent when the user asks in Settings: main's parts (the
 * clock, the zone, the language, the device, the config's status) and the session's last plays,
 * stalls and crashes; a telemetry worker reads the rest from the database, scrubs and posts it.
 */
function sendReport(): Promise<DiagSendResult> {
  return platform.info().then((info) => {
    const at = Date.now();
    const last = config.last.value;
    const parts = diagParts(at, new Date(at).getTimezoneOffset(), document.documentElement.lang, info, deviceProbes(window), last === null ? 'none' : last.status);
    return dataEngine().sendDiagReport({ base: configRequest.base, platform: __PLATFORM__, appVersion: __APP_VERSION__, parts, events: telemetry.recent() });
  });
}

/**
 * Crash reports (RELAY step 33c): main's uncaught errors and unhandled rejections from here on, and
 * the data workers' errors (the engine's `onWorkerError`), at most 3 a session, each recorded as
 * telemetry's `crash`; the telemetry worker scrubs them before they are stored.
 */
const crashes = createCrashReporter({ record: (event) => telemetry.record(event) });
listenForCrashes(window, crashes);

/**
 * The start's events (step 33b1), once its screen has painted: `app_start` (the tier, the time to
 * that first frame, the catalog's size) and `capability` (the worker drops a repeat).
 */
function recordStart(): void {
  requestAnimationFrame(() => {
    const coldStartMs = performance.now();
    const at = Date.now();
    platform.info().then(
      (info) => {
        telemetry.record(capabilityEvent(at, info, deviceProbes(window)));
        dataEngine()
          .summary()
          .then(
            (summary) => telemetry.record(appStartEvent(at, info.tier, coldStartMs, summary.items)),
            (error: unknown) => console.warn('The start was not recorded', error),
          );
      },
      (error: unknown) => console.warn('The start was not recorded', error),
    );
  });
}

const addRefusal = computed(() => refusalFor(config.policy.value, 'block-new-sources'));
const playRefusal = computed(() => refusalFor(config.policy.value, 'disable-playback'));

/** What the live screen stops while the gate stops the app, and starts again when it lifts (step 30c2a). */
let gated: { readonly stop: () => void; readonly resume: () => void } | null = null;
/** The gate stops the app now: a paired source's load that ends meanwhile leaves the refreshes stopped. */
let gateStopped = false;

/** How often a restore waiting for the refresh slot looks again (step 32d2b). */
const SLOT_LOOK_MS = 100;

/** Resolves once no catalog or guide refresh holds the data engine's slot. */
function refreshSlotFree(): Promise<void> {
  return new Promise<void>((resolve) => {
    const look = (): void => {
      if (dataEngine().refreshing) setTimeout(look, SLOT_LOOK_MS);
      else resolve();
    };
    look();
  });
}

/** The TV's tier, `full` when the platform can't say. */
function deviceTier(): Promise<DeviceTier> {
  return platform.info().then(
    (info) => info.tier,
    (): DeviceTier => 'full',
  );
}

/**
 * The pairing screen on `nav` (RELAY step 31c2a): a pair worker per opening, the code's link on
 * this build's API origin (`?api=` in tests), the config's `block-new-sources` and `loader`'s add
 * path. `busy`: a load starts and ends (Settings holds the background refreshes meanwhile).
 * `setPin` (step 38c3, Settings): the done view's "Set a PIN", the pad's new PIN.
 */
function pairingOn(
  nav: Navigator,
  added: (draft: SourceDraft, result: LoadResult) => void,
  loader: SourceLoader,
  busy?: (on: boolean) => void,
  setPin?: (kept: () => void) => void,
): Pairing {
  return createPairing({
    nav,
    session: () => dataEngine().pairing(),
    base: configRequest.base,
    loader,
    refusal: addRefusal,
    lifecycle: (listener) => platform.onLifecycle(listener),
    added,
    // A file sent without a name (step 31d2b1), in the page's language (onboarding and the live screen set it).
    fileName: () => appI18n(document.documentElement.lang || 'en').t('pair.fileName'),
    ...(busy === undefined ? {} : { busy }),
    ...(setPin === undefined ? {} : { setPin }),
  });
}

/**
 * The config's gate (RELAY step 30c2a): `disable-app`, the "update Lablo" screen and the notices,
 * over every screen in a root of its own. It starts with the config (onboarding and the live
 * screen), and takes every key while it shows.
 */
const gate = createGate({
  policy: config.policy,
  version: __APP_VERSION__,
  platform,
  target: window,
  shown: (id) => {
    // Best effort: a notice that can't be kept as shown shows again on the next start.
    dataEngine()
      .editProfile({ kind: 'notice', id })
      .catch((error: unknown) => console.warn('The notice was not kept as shown', error));
  },
  stopped: (on) => {
    gateStopped = on;
    if (on) gated?.stop();
    else gated?.resume();
  },
});

/**
 * The focus of the screen on show, as `window.__LABLO_TEST__.focusPath()` (RELAY step 14b), and
 * the config's last answer and a refresh now (step 30c1).
 */
const showFocus = installTestHook(
  window,
  config,
  {
    // Telemetry's worker writes the database in the background too (step 33b1).
    idle: () => !lookingUp && backup.idle() && telemetry.idle(),
    uploadNow: () => backup.uploadNow(),
  },
  telemetry,
);

/**
 * The player's lifecycle (RELAY step 38b): the platform's, through parental control's hold once the
 * live screen is up (after an unlocked session, `visible` waits for the PIN).
 */
let playerLifecycle: LifecycleSource = (listener) => platform.onLifecycle(listener);

/**
 * The app's player controller, made on the first play (RELAY step 20a): the stage under the page,
 * the platform's engines on it, and the platform's probe, screensaver and lifecycle.
 */
const playerController = appPlayer({
  lifecycle: (listener) => playerLifecycle(listener),
  platform,
  stage: () => createStage(document),
  checkAccount: (src) => dataEngine().account(src),
  online: () => navigator.onLine,
  // Settings › "Player"'s languages (step 38d3), else the page's (LiveApp sets it): sound in it first.
  preferences: () => trackPreferences(memory.audioLang(), memory.subtitleLang(), document.documentElement.lang),
  memory: memory.sources,
  trackMemory: memory.tracks,
  // The config's blocklist (step 30c3b): each stream URL, and Tizen's redirect answer, before it opens.
  blocked: (urls) => dataEngine().blockedOrNone(urls),
  // Telemetry's `play_result` and `stall` (step 33b2).
  report: (report) => telemetry.record(playerEvent(Date.now(), report)),
});

/** The background refreshes while the live screen shows (RELAY step 22a). */
let refreshes: RefreshScheduler | null = null;

/**
 * Starts the refresh schedule for the live screen: stale catalogs and due guides are read in the
 * background, and the screen picks up what swapped in (`readFormats`: the accounts' formats again).
 */
function startRefreshes(live: Live, guide: Guide, posters: readonly Movies[], search: Search, home: Home, readFacts: () => void, firstMs?: number): void {
  refreshes?.dispose();
  refreshes = createRefreshScheduler({
    engine: dataEngine(),
    tier: () =>
      platform.info().then(
        (info) => info.tier,
        (): DeviceTier => 'full',
      ),
    // The live screen sets the page's language (LiveApp): the guides' titles in it first.
    languages: () => {
      const ui = normalizeLang(document.documentElement.lang);
      return ui === '' ? [] : [ui];
    },
    lifecycle: (listener) => platform.onLifecycle(listener),
    onCatalog: () => {
      readFacts();
      live.catalogChanged();
      for (const screen of posters) screen.catalogChanged();
      search.catalogChanged();
      home.catalogChanged();
    },
    onGuides: () => {
      live.guidesChanged();
      guide.guidesChanged();
    },
  });
  refreshes.start(firstMs);
}

/**
 * The live screen (RELAY step 14a): the stored sources' channels, in the language picked in
 * onboarding (`null`: the TV's). OK on a channel opens the player (step 20a). `resume` (step
 * 20c1): the channel watched last plays at once, over the live screen, before its catalog loads.
 * `restored` (step 32c2): the profile has just come back from a backup, with none of its catalogs:
 * the refresh schedule's first check comes at once. `toSources` (step 32d4b): a restored source
 * needs its login again, so Settings › Sources opens over the live screen; `toGuides` (step
 * 32d4c): else a guide of the user's needs its link, so Settings › TV guides does. Settings ›
 * "Language" (step 38d2) switches the language in place: the profile's answer, then the live
 * screen painted again in it.
 */
function showLive(into: Element, language: Language | null, resume: LastChannel | null = null, restored = false, toSources = false, toGuides = false): void {
  let player: Player | null = null;
  /** The player: made further down, before any key reaches the live screen (Settings › "Player" uses it, step 38d3). */
  const livePlayer = (): Player => player!;
  /** The language on show: onboarding's, or the one Settings › "Language" switched to (`null`: the TV's). */
  let shown = language;
  let paint: () => void = () => undefined;
  const readFacts = (): void => {
    dataEngine()
      .sourceFacts()
      .then(
        (facts) => {
          sourceFacts = facts;
        },
        (error: unknown) => console.warn("The sources' facts were not read", error),
      );
  };
  readFacts();
  let openSettings: () => void = () => undefined;
  let lockEntry: () => void = () => undefined;
  let favourite: (item: CatalogItem) => void = () => undefined;
  const live = createLive({
    platform,
    engine: dataEngine(),
    play: (index) => player?.show(index),
    // A search hit or a recent channel in a hidden group (step 35d): it plays over the list on show.
    playOver: (row, guess) => player?.over(row, guess),
    startCategory: resume === null ? null : railRefOf(resume),
    listChanging: () => {
      player?.listChanging();
      guide.listChanging();
    },
    openSettings: () => openSettings(),
    openGuide: (row) => guide.open(row),
    openMovies: () => movies.open(),
    openSeries: () => series.open(),
    openSearch: () => search.open(),
    openHome: () => home.open(),
    // The rail's "Locked groups" / "Lock again" (step 38b).
    lockEntry: () => lockEntry(),
    // The red key on a channel of the list (step 39b).
    favourite: (item) => favourite(item),
  });
  // The red key's favourites panel over the list (step 39b): the info bar's panel, on the live screen.
  const listFavourites = createFavouriteMenu({
    edit: (edit) => dataEngine().editProfile(edit),
    lists: live.lists,
    changed: () => live.listsChanged(),
    platform,
    nav: live.nav,
    // The panel closes itself on Back and STOP; over the list, nothing closes with it.
    closed: () => undefined,
    stop: () => undefined,
  });
  favourite = (item) => listFavourites.show(item);
  // OK on a poster (step 26c): the movie's details over the grid; "Play" opens the player over them, and Back from it returns to them.
  // A movie left part way (step 26d): "Resume from" plays it from there; back from the player, the details read its position again.
  const details = createMovieDetails({
    nav: live.nav,
    engine: dataEngine(),
    progress,
    play: (item, info, fromMs) => {
      const length = movieFacts(item, info).lengthSecs;
      const request = movieRequest(item, info);
      // The panel's length, else the one kept with the movie's place (played before the read came back).
      const left = progress.point(item.key);
      const lengthMs = length !== null ? length * 1000 : left === null ? null : left.lengthMs;
      player?.playMovie({ item, request, lengthMs, ...(fromMs === undefined ? {} : { fromMs }), closed: () => details.refresh() });
    },
  });
  // The header's "Movies" (step 26a): the poster grid of the sources' movies, each tile with its bar (26d); Back returns to the header.
  const movies = createMovies({ nav: live.nav, engine: dataEngine(), tier: () => tier, select: (item) => details.open(item), progress, lockEntry: () => lockEntry() });
  // OK on a show (step 27b): its details over the series grid, its seasons and episodes read from its panel; Back returns to the grid.
  // OK on an episode (step 27c1): the player over the details, from where it was left; Back returns to the details on the show's last episode.
  // Its end (step 27c2): the next episode in the details' seasons, from where it was left, after a countdown.
  const show = createShowDetails({
    nav: live.nav,
    engine: dataEngine(),
    progress,
    play: (item, seasons, place, fromMs) => {
      const closed = (): void => show.refresh();
      const kept = (key: ContentKey): ResumePoint | null => progress.point(key);
      player?.playMovie(episodePlay(fromMs === undefined ? { show: item, seasons, place, kept, closed } : { show: item, seasons, place, kept, fromMs, closed }));
    },
  });
  // The header's "Series" (step 27a): the movies screen for series. A playlist's episode opens as a movie does; a panel's show opens its details.
  const series = createMovies({
    nav: live.nav,
    engine: dataEngine(),
    kind: 'series',
    tier: () => tier,
    select: (item) => selectSeries(item, { episode: (episode) => details.open(episode), show: (item) => show.open(item) }),
    progress,
    lockEntry: () => lockEntry(),
  });
  // The header's "Search" (step 28a): OK on a channel plays it from its group (the live list shows it), on a movie or a show opens its details; Back returns to the search.
  const search = createSearch({
    nav: live.nav,
    engine: dataEngine(),
    platform,
    select: (item, hit) => {
      if (item.kind === 'live') void live.playFound({ key: item.key, src: hit.src, catIdx: hit.catIdx, chunk: hit.chunk, slot: hit.slot, item });
      else if (item.kind === 'movie') details.open(item);
      else selectSeries(item, { episode: (episode) => details.open(episode), show: (found) => show.open(found) });
    },
  });
  // The header's "Home" (step 28b1): shelves of what was left part way, the newest movies and the series updated last; OK on a tile opens its details, as on its own screen.
  // "Recent channels" (step 28b2): OK plays the channel from its group on the live list, the player over Home; Back returns to Home.
  const home = createHome({
    nav: live.nav,
    engine: dataEngine(),
    tier: () => tier,
    select: (item) => {
      if (item.kind === 'movie') details.open(item);
      else selectSeries(item, { episode: (episode) => details.open(episode), show: (found) => show.open(found) });
    },
    progress,
    channels: memory,
    play: (channel) => void live.playKept(railRefOf(channel), channel.item.key, channel.index, { item: channel.item, number: channel.number }),
  });
  // The header's "Guide" (step 23c): the grid over the list's category; OK on air plays, Back returns to the list.
  const guide = createGuide({
    nav: live.nav,
    engine: dataEngine(),
    list: live.list,
    tier: () => tier,
    play: (index) => player?.show(index),
    closed: (index) => live.focusRow(index),
    // "Guide channel" in the programme details (step 24e): the manual mapping's picker over the guide (in settings.js, step 35e).
    map: (target) => settings.use((file) => file.settings.mapping.open(target)),
    // "Watch from the start" (step 25a): the programme from the channel's archive, the player over the guide.
    catchup: (index, programme) => player?.catchup(index, programme),
  });
  // The header's "Settings" (step 22b2): the guides screen changes the guide list, then reads it.
  // A guide's time offset (step 24b) needs no refresh: the screens ask their programmes again.
  // Sources › "Add from your phone" (step 31c2a): the background refreshes wait while the phone's
  // source loads; once it is in, the screens read the catalogs and guides again.
  const addLoader = createEngineLoader({
    engine: dataEngine(),
    tier: deviceTier,
    languages: () => {
      const ui = normalizeLang(document.documentElement.lang);
      return ui === '' ? [] : [ui];
    },
  });
  // Settings' "Restore it" (step 32d2b): the app starts again on the restored profile.
  let restarting = false;
  const holdRefreshes = (on: boolean): void => {
    if (on) {
      refreshes?.dispose();
      refreshes = null;
    } else if (!gateStopped && !restarting) {
      startRefreshes(live, guide, [movies, series], search, home, readFacts);
    }
  };
  /** Runs `job` with no catalog or guide refresh running or starting (a restore clears the catalogs). */
  function quiet<T>(job: () => Promise<T>): Promise<T> {
    holdRefreshes(true);
    const again = (): void => holdRefreshes(false);
    return refreshSlotFree()
      .then(job)
      .then(
        (value) => {
          again();
          return value;
        },
        (error: unknown) => {
          again();
          throw error;
        },
      );
  }
  /** A source's catalog came in outside the schedule (the phone's add, a login given again): the screens read it, and its guides. */
  const sourceAdded = (): void => {
    readFacts();
    live.catalogChanged();
    movies.catalogChanged();
    series.catalogChanged();
    search.catalogChanged();
    home.catalogChanged();
    live.guidesChanged();
    guide.guidesChanged();
  };
  // The settings' screens are in settings.js (step 35e): what they need from here is kept, and they are made when the file is in.
  const settingsOptions: SettingsOptions = {
    nav: live.nav,
    engine: dataEngine(),
    refreshNow: () => (refreshes === null ? Promise.resolve() : refreshes.refreshNow()),
    offsetChanged: () => {
      live.guidesChanged();
      guide.guidesChanged();
    },
    platform,
    // A source with locked groups added while no PIN is set (step 38c3): the done view's "Set a PIN" opens the pad below.
    pairing: (nav, added) => pairingOn(nav, added, addLoader, holdRefreshes, (kept) => parental.choose(kept)),
    backup: {
      engine: dataEngine(),
      host: {
        request: backupCall,
        schedule: backup,
        quiet,
        // The player closes, the refreshes and the uploads stop, then the start's path again: "Welcome back".
        restart: () => {
          restarting = true;
          gated?.stop();
          location.replace(restartUrl(location.href));
        },
      },
    },
    sourceAdded,
    // "Usage and crash reports" (step 33b3): the profile's switch, then telemetry follows what it stored.
    telemetry: { engine: dataEngine(), setOn: (on) => telemetry.setOn(on) },
    // "Send a report to support" (step 33d2): main's parts and the session's last events; the worker adds the rest.
    report: { send: sendReport },
    // "Channel groups" (step 35d): after each edit the live screen reads the lists and groups again.
    listsChanged: () => void live.listsChanged(),
    // "Edit channel" and "Channels" (step 36c): after each edit the live screen reads the channels again.
    channelsChanged: () => live.channelsChanged(),
    // "Parental control" (step 38c1): the PIN pad below, and after each change of the locks every screen reads again.
    pad: {
      ask: (done) => parental.ask(done),
      choose: (done) => parental.choose(done),
    },
    locksChanged: () => {
      void live.channelsChanged();
      movies.catalogChanged();
      series.catalogChanged();
      search.catalogChanged();
      home.catalogChanged();
    },
    lifecycle: (listener) => platform.onLifecycle(listener),
    // "Language" (step 38d2): the page's language (LiveApp sets it; en-XA reads `en`); a switch
    // writes onboarding's answer (best effort: a write that fails leaves the next start in the old
    // language), then the live screen paints again in the new one, Settings included.
    language: {
      current: () => (normalizeLang(document.documentElement.lang) === 'ar' ? 'ar' : 'en'),
      set: (picked) => {
        dataEngine()
          .editProfile(answerEdit({ language: picked }))
          .catch((error: unknown) => console.warn('The language was not saved', error));
        shown = picked;
        paint();
      },
    },
    // "Player" (step 38d3): the languages are the profile's (read at each stream's tracks); the
    // subtitles' size and the picture go through the player, as its own menus change them.
    player: {
      modes: () => livePlayer().pictureModes(),
      values: () => {
        const made = livePlayer();
        return { audio: memory.audioLang(), subtitles: memory.subtitleLang(), size: made.menu.size.value, picture: made.picture.value, clock: made.watchClock.value, still: made.stillHours.value };
      },
      setAudio: (lang) => memory.setAudioLang(lang),
      setSubtitles: (lang) => memory.setSubtitleLang(lang),
      setSize: (size) => livePlayer().setSubtitleSize(size),
      setPicture: (mode) => livePlayer().setPicture(mode),
      setClock: (on) => livePlayer().setWatchClock(on),
      // "Still watching?" and the sleep timer (step 39c): the player's; the timer's row reads its signal.
      setStill: (hours) => livePlayer().setStillHours(hours),
      sleep: () => livePlayer().sleep.value,
      setSleep: (minutes) => livePlayer().setSleep(minutes),
    },
    // A login given again (step 32d4b): the source's own refresh with the schedule held (the
    // schedule keeps a refused `needs-login` for 2 h, and `refreshNow` reads only the guides), then
    // its guides at once and the screens.
    refreshSource: (src, source) =>
      quiet(() => deviceTier().then((tier) => dataEngine().refresh({ src, source }, { lowTier: tier === 'low' }))).then((result) => {
        if (result.status === 'committed') {
          void refreshes?.refreshNow();
          sourceAdded();
        }
        return result;
      }),
  };
  // settings.js loads the first time Settings opens (or the guide's "Guide channel"): a loading screen meanwhile, Back cancels.
  const settings = createLazyFile<LoadedSettings>({
    nav: live.nav,
    load: () => import('./settings/settings').then((file) => file.loadSettings(settingsOptions)),
  });
  openSettings = () => settings.use((file) => file.settings.open());
  // Parental control (step 38b): the rails' last entry, the PIN pad, and the end of an unlocked
  // session when the app is hidden. After an unlock or a relock every screen reads again; Back on
  // the pad that asks when the app comes back starts the app again, locked.
  const parental = createParental({
    nav: live.nav,
    engine: dataEngine(),
    lifecycle: (listener) => platform.onLifecycle(listener),
    changed: (unlocked) => {
      void live.lockChanged(unlocked);
      movies.lockChanged(unlocked);
      series.lockChanged(unlocked);
      search.catalogChanged();
      home.catalogChanged();
    },
    restart: () => {
      restarting = true;
      gated?.stop();
      location.reload();
    },
    // The no-PIN dialog's "Set a PIN" (step 38c2): settings.js's login check first.
    check: (matched) =>
      settings.use((file) => {
        file.settings.parental?.check.run(matched);
      }),
  });
  lockEntry = () => parental.toggle();
  playerLifecycle = parental.heldLifecycle;
  // OK on a channel opens the player on the live navigator (step 20a); Back returns to its row.
  const kept = memory.subtitleSize();
  const picture = memory.picture();
  player = createPlayer({
    nav: live.nav,
    list: live.list,
    player: playerController,
    chrome: (on) => setPlayerChrome(document, on),
    // Back from the player: the list on the channel that played, and the guide when the player opened from it.
    closed: (index) => {
      live.focusRow(index);
      guide.follow(index);
    },
    tuned: (row, index) => memory.tuned(row.item, row.number, live.shownCategory(), index),
    outputFormats: (src) => sourceFacts.get(src)?.outputFormats ?? null,
    catchupRequest: (row, programme, from) => catchupRequest(row, programme, sourceFacts.get(row.item.src), Date.now(), from),
    // A catch-up playing on past its programme (step 25d): the programme aired then, as the guide shows it.
    programmeAt: (row, at) =>
      dataEngine()
        .nowNext([row.item.key], at)
        .then((found) => {
          const now = found.length === 0 ? null : found[0]!.now;
          return now === null ? null : { start: now.start, end: now.end, title: now.title };
        }),
    ...(kept === null ? {} : { subtitleSize: kept }),
    sized: (size) => memory.setSubtitleSize(size),
    ...(picture === null ? {} : { picture }),
    pictured: (mode) => memory.setPicture(mode),
    // "Clock while watching" (step 39a).
    watchClock: memory.clock(),
    watchClocked: (on) => memory.setClock(on),
    // "Still watching?" (step 39c): its hours; the sleep timer lives in the player, for this run only.
    stillHours: memory.stillHours(),
    stillSet: (hours) => memory.setStillHours(hours),
    // The Guide key on a channel (step 39a): the guide on the channel's row, over the live screen or the guide.
    toGuide: (under) =>
      guideFromPlayer(
        under,
        () => live.status.value === 'ready',
        (row) => guide.open(row),
      ),
    // Where a movie is (step 26d): every 10 s while it plays, and when it stops, is left or the app hides; an episode's with its show (step 27c1),
    // and whether one comes after it (step 27d: "Continue watching").
    progressed: (item, positionMs, lengthMs, ended, showKey, more) => progress.save(item.key, positionMs, lengthMs, ended, showKey, more),
    // Held after an unlocked session until the PIN (step 38b), as the controller's is.
    lifecycle: parental.heldLifecycle,
    // The config's disable-playback (step 30c2b). The start's last channel plays before the cached policy arrives, then stops.
    refusal: playRefusal,
    // Each config answer (step 30c3b): the stream on show is asked about again, after the query worker read the new blocklist.
    blocklist: config.last,
    // The info bar's star (step 35c): the panel edits the favourites lists, then the live screen reads them again.
    favourites: { edit: (edit) => dataEngine().editProfile(edit), lists: live.lists, changed: () => live.listsChanged(), platform },
    // The info bar's pencil (step 36c): settings.js's "Edit channel" over the player.
    editChannel: {
      open: (item, closed, stop) => settings.use((file) => file.settings.channel.openOver(item, closed, stop)),
      close: () => settings.loaded.value?.settings.channel.close(),
    },
  });
  // The channel watched last plays once the query worker gives it (step 38b): a locked one, or one
  // gone from the catalog, doesn't play; nor does it once the user has moved on.
  if (resume !== null) {
    const resumed = player;
    dataEngine()
      .itemsByKey({ keys: [resume.item.key], kind: 'live', sources: [resume.item.src], limit: 1 })
      .then(
        (found) => {
          if (found.length > 0 && live.nav.top === live.home) resumed.resume({ item: resume.item, number: resume.number }, resume.index);
        },
        (error: unknown) => console.warn('The last channel could not be checked', error),
      );
  }
  showFocus(live.nav);
  paint = () => render(<LiveApp platform={platform} live={live} language={shown} player={player} settings={settings} guide={guide} movies={movies} series={series} details={details} show={show} search={search} home={home} parental={parental} favourites={listFavourites} />, into);
  paint();
  startRefreshes(live, guide, [movies, series], search, home, readFacts, restored ? 0 : undefined);
  backup.start();
  telemetry.start();
  if (toSources) settings.use((file) => file.settings.openSources());
  else if (toGuides) settings.use((file) => file.settings.openGuides());
  // Under the gate's `disable-app` or update (step 30c2a): the player closes, the refreshes and the backup's uploads stop, until it lifts.
  gated = {
    stop: () => {
      player?.close();
      refreshes?.dispose();
      refreshes = null;
      backup.stop();
      telemetry.stop();
    },
    resume: () => {
      startRefreshes(live, guide, [movies, series], search, home, readFacts);
      backup.start();
      telemetry.start();
    },
  };
}

/**
 * Onboarding (RELAY steps 13a and 13b): the source loads through the data engine, and every
 * answer goes into the profile as it is given. "Start watching" opens the live screen.
 */
function showOnboarding(into: Element, language: Language | null): void {
  const data = dataEngine();
  let onboarding: Onboarding | null = null;
  const loader = createEngineLoader({
    engine: data,
    tier: () => platform.info().then(
      (info) => info.tier,
      (): DeviceTier => 'full',
    ),
    languages: () => {
      const picked = onboarding?.language.peek() ?? null;
      return picked === null ? [] : [picked];
    },
  });
  const started = createOnboarding({
    platform,
    loader,
    initial: { language },
    // The config's block-new-sources (step 30c2b), read at "Add source".
    refusal: addRefusal,
    // "Use your phone" (step 31c2a): the pairing screen, its source added by the same loader.
    pairing: (nav, added) => pairingOn(nav, added, loader),
    // "Restore with a backup code" (step 32d3c): the backup worker restores over no profile or a
    // sourceless one, after the refresh slot is free; the app then starts again on the profile.
    restoreCode: {
      engine: data,
      build: { platform: BACKUP_BUILD.platform, appId: BACKUP_BUILD.appId, base: configRequest.base },
      slotFree: refreshSlotFree,
      restart: (restored) => {
        // Restored: "Welcome back", as after Settings' "Restore it"; kept (a source got there meanwhile): a plain start.
        if (restored) location.replace(restartUrl(location.href));
        else location.reload();
      },
    },
    // The done screen's "Set a PIN" (step 38c3): a pad of onboarding's own, with no session to end on hide (nothing is unlocked).
    pad: (nav) => createParental({ nav, engine: data, changed: () => undefined, restart: () => location.reload() }),
    answer: (answer) => {
      // Best effort: an answer that can't be saved is asked again on the next start.
      data.editProfile(answerEdit(answer)).catch((error: unknown) => console.warn('The onboarding answer was not saved', error));
    },
  });
  onboarding = started;
  showFocus(started.nav);
  const finish = (): void => {
    const picked = started.language.peek();
    started.dispose();
    showLive(into, picked);
  };
  render(<OnboardingApp platform={platform} onboarding={started} onFinish={finish} />, into);
}

/**
 * The start's screen for `profile`: the live screen when it has a source, else onboarding; then
 * the gate and the config. `restored` (step 32c2): the profile has just come back from a backup,
 * so the channel watched last doesn't play by itself (its catalog is being read again, and its
 * address may be months old) and the catalogs are read at once.
 */
function startWith(into: Element, profile: LoadedProfile | null, restored: boolean, toSources = false, toGuides = false): void {
  memory.load(profile);
  progress.load(profile);
  // Telemetry's switch (step 33b1): on unless the profile says `telemetry: false`.
  telemetry.load(telemetryOn(profile));
  const start = startPoint(profile);
  if (start.screen === 'home') showLive(into, start.language, restored ? null : start.resume, restored, toSources, toGuides);
  else showOnboarding(into, start.language);
  recordStart();
  // The gate over every screen (step 30c2a), in its own root after #app; nothing shows until the config says so.
  const gateRoot = document.createElement('div');
  document.body.appendChild(gateRoot);
  render(<GateApp platform={platform} gate={gate} />, gateRoot);
  gate.start(noticesShownOf(profile));
  // After the start's screen has painted: the config never delays it.
  config.start();
}

/**
 * A start after Settings' "Restore it" (RELAY step 32d2b, `?restored=1`): "Welcome back" on the
 * restored profile at once, then the live screen as after a restore at a first start.
 */
function startRestored(into: Element, profile: LoadedProfile): void {
  const welcome = createBackupStart({ engine: dataEngine(), restored: profile });
  showFocus(welcome.nav);
  render(<BackupStartApp platform={platform} start={welcome} />, into);
  void welcome.done.then((end) => {
    startWith(into, end.profile, end.restored, end.toSources, end.toGuides);
    welcome.dispose();
  });
}

/**
 * A start with no profile (RELAY step 32c2, Omar's decision in step 32): a fresh install, or a
 * TV whose app data was wiped. Before onboarding asks anything, the TV reads its device ID (the one
 * read with no consent asked) and looks for its backup behind "Looking for your backup"; a profile
 * that came back shows "Welcome back", then the live screen. No device ID: onboarding at once.
 */
function startWithoutProfile(into: Element): void {
  void lookupRequest(platform, BACKUP_BUILD, configRequest.base).then((request) => {
    if (request === null) {
      startWith(into, null, false);
      return;
    }
    lookingUp = true;
    const look = createBackupStart({ engine: dataEngine(), request });
    showFocus(look.nav);
    render(<BackupStartApp platform={platform} start={look} />, into);
    void look.done.then((end) => {
      lookingUp = false;
      startWith(into, end.profile, end.restored, end.toSources, end.toGuides);
      look.dispose();
    });
  });
}

// The developer screens behind `?screen=` (RELAY step 35b): the dev app's and the TV build's test
// copy's only; the store build's stand-in shows none, so it starts as a TV does.
if (!showDevScreen(readScreen(location.search), root, { platform, showFocus, dataEngine, configRequest, busy })) {
  // The profile decides: a stored source skips onboarding (step 13b).
  render(
    <main class="onboarding" data-testid="onboarding" data-ready="false">
      <Spinner size="l" />
    </main>,
    root,
  );
  void readStartProfile(dataEngine()).then((profile) => {
    if (profile === null) startWithoutProfile(root);
    else if (readRestored(location.search)) startRestored(root, profile);
    else startWith(root, profile, false);
  });
}
