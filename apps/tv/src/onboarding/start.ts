import type { LastChannel, LoadedProfile } from '@lablo/data';
import type { Language } from '@lablo/ui';
import { lastChannelOf } from '../player/player-memory';
import { storedSources } from './engine-loader';
import type { OnboardingAnswer } from './onboarding-state';
import { LANGUAGES } from './onboarding-state';

/**
 * Where the app starts (RELAY step 13b): onboarding until a source is stored, then the app
 * itself (the live screen, step 14a). A start that didn't finish onboarding comes back in the
 * language picked then. A start with a source plays the channel watched last at once, before
 * the live screen's catalog loads (step 20c1, architecture.md §2 "Start on last channel").
 */

export interface StartPoint {
  /** `home`: a source is stored, onboarding is skipped. */
  readonly screen: 'onboarding' | 'home';
  /** The language saved in the profile (`null`: none yet; the TV's language shows). */
  readonly language: Language | null;
  /** `home` only: the channel watched last, when its source is still stored (`null`: none). */
  readonly resume: LastChannel | null;
}

/** How long the app waits for the profile before it starts onboarding without it. */
export const PROFILE_WAIT_MS = 10_000;

export function startPoint(profile: LoadedProfile | null): StartPoint {
  const answers = profile === null ? null : (profile.doc as { onboarding?: { language?: unknown } }).onboarding;
  const saved = answers?.language;
  let language: Language | null = null;
  for (const known of LANGUAGES) if (known === saved) language = known;
  const sources = storedSources(profile);
  if (sources.length === 0) return { screen: 'onboarding', language, resume: null };
  const last = lastChannelOf(profile);
  const stored = last !== null && sources.some((s) => s.id === last.item.src);
  return { screen: 'home', language, resume: stored ? last : null };
}

export interface ProfileReader {
  profile(): Promise<LoadedProfile | null>;
}

/**
 * The profile, or `null` when it can't be read: no IndexedDB, a query worker that failed, or no
 * answer within `waitMs`. The app then starts onboarding, as on a fresh install.
 */
export function readStartProfile(
  engine: ProfileReader,
  waitMs = PROFILE_WAIT_MS,
  later: (run: () => void, ms: number) => unknown = (run, ms) => setTimeout(run, ms),
): Promise<LoadedProfile | null> {
  return new Promise((resolve) => {
    later(() => resolve(null), waitMs);
    engine.profile().then(resolve, () => resolve(null));
  });
}

/** An onboarding answer as a profile edit (the profile's language is a plain code). */
export function answerEdit(answer: OnboardingAnswer): { kind: 'answers'; answers: { language?: string; disclaimerAt?: number; consent?: boolean } } {
  const answers: { language?: string; disclaimerAt?: number; consent?: boolean } = {};
  if (answer.language !== undefined) answers.language = answer.language;
  if (answer.disclaimerAt !== undefined) answers.disclaimerAt = answer.disclaimerAt;
  if (answer.consent !== undefined) answers.consent = answer.consent;
  return { kind: 'answers', answers };
}
