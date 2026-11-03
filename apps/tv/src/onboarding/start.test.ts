import type { LoadedProfile } from '@zoma/data';
import { describe, expect, it } from 'vitest';
import { PROFILE_WAIT_MS, answerEdit, readStartProfile, startPoint } from './start';

const loaded = (doc: Record<string, unknown>): LoadedProfile => ({ doc: { v: 2, ...doc }, newer: false, migratedFrom: null });
const SOURCE = { id: 's1', type: 'm3u', name: 'A', url: 'http://a.test', epgUrl: null, added: 1 };

describe('startPoint', () => {
  it('starts onboarding until a source is stored, then skips it', () => {
    expect(startPoint(null)).toEqual({ screen: 'onboarding', language: null });
    expect(startPoint(loaded({ sources: [], onboarding: { language: null } }))).toEqual({ screen: 'onboarding', language: null });
    expect(startPoint(loaded({ sources: [SOURCE], onboarding: { language: 'en' } }))).toEqual({ screen: 'home', language: 'en' });
    // A newer app version's profile with sources: still skipped.
    expect(startPoint({ doc: { v: 9, sources: [SOURCE] }, newer: true, migratedFrom: null }).screen).toBe('home');
  });

  it('comes back in the language picked by a start that did not finish; unknown languages are ignored', () => {
    expect(startPoint(loaded({ sources: [], onboarding: { language: 'ar' } })).language).toBe('ar');
    expect(startPoint(loaded({ sources: [], onboarding: { language: 'fr' } })).language).toBeNull();
    expect(startPoint(loaded({ sources: [] })).language).toBeNull();
    expect(startPoint({ doc: { v: 1, favourites: [] }, newer: false, migratedFrom: null })).toEqual({ screen: 'onboarding', language: null });
  });
});

describe('readStartProfile', () => {
  it('gives the profile, or null when it fails or takes too long', async () => {
    const profile = loaded({ sources: [] });
    const never = (): void => undefined;
    expect(await readStartProfile({ profile: () => Promise.resolve(profile) }, PROFILE_WAIT_MS, never)).toBe(profile);
    expect(await readStartProfile({ profile: () => Promise.reject(new Error('no IndexedDB')) }, PROFILE_WAIT_MS, never)).toBeNull();
    let timeout: { run: () => void; ms: number } | null = null;
    const waiting = readStartProfile({ profile: () => new Promise(() => undefined) }, 1234, (run, ms) => (timeout = { run, ms }));
    expect(timeout).toMatchObject({ ms: 1234 });
    timeout!.run();
    expect(await waiting).toBeNull();
    expect(PROFILE_WAIT_MS).toBe(10_000);
  });
});

describe('answerEdit', () => {
  it('turns an answer into a profile edit with only the fields given', () => {
    expect(answerEdit({ language: 'ar' })).toEqual({ kind: 'answers', answers: { language: 'ar' } });
    expect(answerEdit({ disclaimerAt: 5 })).toEqual({ kind: 'answers', answers: { disclaimerAt: 5 } });
    expect(answerEdit({ consent: false })).toEqual({ kind: 'answers', answers: { consent: false } });
    expect(answerEdit({})).toEqual({ kind: 'answers', answers: {} });
  });
});
