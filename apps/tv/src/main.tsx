import { signal } from '@preact/signals';
import { render } from 'preact';
import type { DeviceTier } from '@lablo/core';
import { normalizeLang } from '@lablo/core';
import type { LastChannel } from '@lablo/data';
import type { Language } from '@lablo/ui';
import { Spinner } from '@lablo/ui';
import type { AppData } from './App';
import { App } from './App';
import type { DataEngine, SourceFacts } from './data/engine';
import { readDebugParams, readScreen } from './data/params';
import type { RefreshScheduler } from './data/refresh-scheduler';
import { createRefreshScheduler } from './data/refresh-scheduler';
import { createSettings } from './settings/settings-state';
import { createAppDataEngine } from './data/workers';
import { createFocusDemo } from './focus-demo';
import { LiveApp } from './live/LiveApp';
import type { Live } from './live/live-state';
import { createLive } from './live/live-state';
import { GalleryApp } from './gallery/GalleryApp';
import { createGallery } from './gallery/gallery-state';
import { GuideGalleryApp } from './gallery/GuideGalleryApp';
import { createGuideGallery } from './gallery/guide-gallery';
import type { Guide } from './guide/guide-state';
import { createGuide } from './guide/guide-state';
import type { Movies } from './movies/movies-state';
import { createMovies, selectSeries } from './movies/movies-state';
import { episodePlay } from './shows/episode-play';
import { createShowDetails } from './shows/show-details';
import { createMovieDetails, movieFacts, movieRequest } from './movies/movie-details';
import { createMovieProgress } from './movies/movie-progress';
import { createEngineLoader } from './onboarding/engine-loader';
import { OnboardingApp } from './onboarding/OnboardingApp';
import type { Onboarding } from './onboarding/onboarding-state';
import { appPlayer, uiTrackPreferences } from './player/app-player';
import { catchupRequest } from './player/catchup';
import { createPlayerMemory } from './player/player-memory';
import type { Player } from './player/player-state';
import { createPlayer } from './player/player-state';
import { createStage, setPlayerChrome } from './player/stage';
import { createOnboarding } from './onboarding/onboarding-state';
import { answerEdit, readStartProfile, startPoint } from './onboarding/start';
import { KEY_HELP, createPlatform } from './platform';
import { installTestHook } from './test-hook';
// Last, so the app's own CSS comes after @lablo/ui's (tokens, fonts, components) in app.css and in dev.
import './app.css';

/**
 * What the player keeps in the profile (RELAY step 20c1): filled from the start's profile, written
 * through the data engine (made by then: only a play writes).
 */
const memory = createPlayerMemory({ edit: (edit) => dataEngine().editProfile(edit) });
/** Where each movie was left (RELAY step 26d): filled from the start's profile, saved by the player. */
const progress = createMovieProgress({ edit: (edit) => dataEngine().editProfile(edit) });
const platform = createPlatform({ redirects: memory.redirects });
platform.registerKeys();
/** The focus of the screen on show, as `window.__LABLO_TEST__.focusPath()` (RELAY step 14b). */
const showFocus = installTestHook(window);
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
    });
  }
  return engine;
}

/**
 * The app's player controller, made on the first play (RELAY step 20a): the stage under the page,
 * the platform's engines on it, and the platform's probe, screensaver and lifecycle.
 */
const playerController = appPlayer({
  platform,
  stage: () => createStage(document),
  checkAccount: (src) => dataEngine().account(src),
  online: () => navigator.onLine,
  // The live screen sets the page's language (LiveApp): sound in it first.
  preferences: () => uiTrackPreferences(document.documentElement.lang),
  memory: memory.sources,
  trackMemory: memory.tracks,
});

/** The background refreshes while the live screen shows (RELAY step 22a). */
let refreshes: RefreshScheduler | null = null;

/**
 * Starts the refresh schedule for the live screen: stale catalogs and due guides are read in the
 * background, and the screen picks up what swapped in (`readFormats`: the accounts' formats again).
 */
function startRefreshes(live: Live, guide: Guide, posters: readonly Movies[], readFacts: () => void): void {
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
    },
    onGuides: () => {
      live.guidesChanged();
      guide.guidesChanged();
    },
  });
  refreshes.start();
}

/** The hello screen: developer diagnostics of the device, the workers and the data layer. */
function showHello(into: Element): void {
  const data: AppData = { engine: dataEngine(), params: readDebugParams(location.search), busy };
  const focus = createFocusDemo(platform);
  showFocus(focus.nav);
  render(<App platform={platform} keyHelp={KEY_HELP} data={data} focus={focus} />, into);
}

/**
 * The live screen (RELAY step 14a): the stored sources' channels, in the language picked in
 * onboarding (`null`: the TV's). OK on a channel opens the player (step 20a). `resume` (step
 * 20c1): the channel watched last plays at once, over the live screen, before its catalog loads.
 */
function showLive(into: Element, language: Language | null, resume: LastChannel | null = null): void {
  let player: Player | null = null;
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
  const live = createLive({
    platform,
    engine: dataEngine(),
    play: (index) => player?.show(index),
    startCategory: resume === null ? null : resume.category,
    listChanging: () => {
      player?.listChanging();
      guide.listChanging();
    },
    openSettings: () => openSettings(),
    openGuide: (row) => guide.open(row),
    openMovies: () => movies.open(),
    openSeries: () => series.open(),
  });
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
  const movies = createMovies({ nav: live.nav, engine: dataEngine(), tier: () => tier, select: (item) => details.open(item), progress });
  // OK on a show (step 27b): its details over the series grid, its seasons and episodes read from its panel; Back returns to the grid.
  // OK on an episode (step 27c1): the player over the details, from where it was left; Back returns to the details on the show's last episode.
  const show = createShowDetails({
    nav: live.nav,
    engine: dataEngine(),
    progress,
    play: (item, episode, index, fromMs) => {
      const closed = (): void => show.refresh();
      const kept = progress.point(episode.key);
      player?.playMovie(episodePlay(fromMs === undefined ? { show: item, episode, index, kept, closed } : { show: item, episode, index, kept, fromMs, closed }));
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
  });
  // The header's "Guide" (step 23c): the grid over the list's category; OK on air plays, Back returns to the list.
  const guide = createGuide({
    nav: live.nav,
    engine: dataEngine(),
    list: live.list,
    tier: () => tier,
    play: (index) => player?.show(index),
    closed: (index) => live.focusRow(index),
    // "Guide channel" in the programme details (step 24e): the manual mapping's picker over the guide.
    map: (target) => settings.mapping.open(target),
    // "Watch from the start" (step 25a): the programme from the channel's archive, the player over the guide.
    catchup: (index, programme) => player?.catchup(index, programme),
  });
  // The header's "Settings" (step 22b2): the guides screen changes the guide list, then reads it.
  // A guide's time offset (step 24b) needs no refresh: the screens ask their programmes again.
  const settings = createSettings({
    nav: live.nav,
    engine: dataEngine(),
    refreshNow: () => (refreshes === null ? Promise.resolve() : refreshes.refreshNow()),
    offsetChanged: () => {
      live.guidesChanged();
      guide.guidesChanged();
    },
    platform,
  });
  openSettings = () => settings.open();
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
    // Where a movie is (step 26d): every 10 s while it plays, and when it stops, is left or the app hides; an episode's with its show (step 27c1).
    progressed: (item, positionMs, lengthMs, ended, showKey) => progress.save(item.key, positionMs, lengthMs, ended, showKey),
    lifecycle: (listener) => platform.onLifecycle(listener),
  });
  if (resume !== null) player.resume({ item: resume.item, number: resume.number }, resume.index);
  showFocus(live.nav);
  render(<LiveApp platform={platform} live={live} language={language} player={player} settings={settings} guide={guide} movies={movies} series={series} details={details} show={show} />, into);
  startRefreshes(live, guide, [movies, series], readFacts);
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

const screen = readScreen(location.search);
if (screen === 'gallery') {
  // The component gallery (RELAY step 11b): no data workers.
  const gallery = createGallery(platform);
  showFocus(gallery.nav);
  render(<GalleryApp platform={platform} gallery={gallery} />, root);
} else if (screen === 'gallery-guide') {
  // The grid guide's gallery page (RELAY step 23b): made-up rows, no data workers.
  const guide = createGuideGallery(platform);
  showFocus(guide.nav);
  render(<GuideGalleryApp platform={platform} gallery={guide} />, root);
} else if (screen === 'hello') {
  showHello(root);
} else {
  // The profile decides: a stored source skips onboarding (step 13b).
  render(
    <main class="onboarding" data-testid="onboarding" data-ready="false">
      <Spinner size="l" />
    </main>,
    root,
  );
  void readStartProfile(dataEngine()).then((profile) => {
    memory.load(profile);
    progress.load(profile);
    const start = startPoint(profile);
    if (start.screen === 'home') showLive(root, start.language, start.resume);
    else showOnboarding(root, start.language);
  });
}
