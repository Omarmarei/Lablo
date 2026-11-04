import { stripIsolates } from '@zoma/core';
import type { EpgMeta, EpgSummary } from '@zoma/data';
import { describe, expect, it } from 'vitest';
import { appI18n } from '../i18n';
import type { GuideRow } from './guides-state';
import { failureText, readText } from './SettingsScreen';

const en = appI18n('en-US', { isolate: false });
const ar = appI18n('ar-SA');

function summary(matched: number, wanted: number): EpgSummary {
  return {
    wanted,
    matched,
    byMethod: { override: 0, id: matched, 'xtream-id': 0, name: 0, 'match-name': 0 },
    ambiguous: 0,
    declared: 0,
    used: 0,
    programmes: 0,
    kept: 0,
    buckets: 0,
    pastDays: 0,
    futureDays: 0,
  };
}

function row(patch: Partial<EpgMeta>): GuideRow {
  const meta: EpgMeta = { epgSrc: 'u~g1', gen: 1, building: null, nextGen: 2, updatedAt: 1, checkedAt: 1, rank: 0, ...patch };
  return { kind: 'mine', epgSrc: 'u~g1', id: 'g1', link: 'guides.test/a.xml', source: '', meta };
}

/** 2026-11-05 21:30 UTC, in UTC minutes. */
const UNTIL = Date.UTC(2026, 10, 5, 21, 30) / 60_000;

describe('a guide’s row text (RELAY step 22b2)', () => {
  it('says why its last try failed, per code', () => {
    expect(failureText(en.t, { code: 'http', status: 404 })).toBe("Couldn't read it: the server answered with error 404.");
    expect(failureText(en.t, { code: 'http', status: null })).toBe("Couldn't read it: the server answered with error 0.");
    expect(failureText(en.t, { code: 'auth', status: 403 })).toBe("Couldn't read it: the server refused access.");
    expect(failureText(en.t, { code: 'network', status: null })).toBe("Couldn't read it: the server couldn't be reached.");
    expect(failureText(en.t, { code: 'format', status: null })).toBe("Couldn't read it: this link didn't give an XMLTV guide.");
    expect(failureText(en.t, { code: 'empty', status: null })).toBe("Couldn't read it: you have no live channels for it to match.");
    expect(failureText(en.t, { code: 'failed', status: null })).toBe("Couldn't read it. It will be tried again later.");
    expect(failureText(en.t, { code: 'superseded', status: null })).toBe("Couldn't read it. It will be tried again later.");
    // In Arabic, with the format name isolated.
    expect(stripIsolates(failureText(ar.t, { code: 'format', status: null }))).toBe('تعذّرت قراءته: لم يُرجع هذا الرابط دليل XMLTV.');
  });

  it('gives the programmes’ end in the TV’s day and time, and the match rate', () => {
    const text = readText(en, row({ until: UNTIL, summary: summary(34, 40) }));
    expect(text.until).toBe(`Programmes until ${en.date(new Date(UNTIL * 60_000), 'day')}, ${en.time(new Date(UNTIL * 60_000))}`);
    expect(text.matched).toBe('Channels matched: 34 of 40 (85%)');
    expect(stripIsolates(readText(ar, row({ until: UNTIL, summary: summary(1, 3) })).matched)).toBe('القنوات المطابقة: 1 من 3 (33%)');
  });

  it('says when no programmes are ahead, shows no rate without a summary, and 0% with nothing to match', () => {
    expect(readText(en, row({ until: null, summary: null }))).toEqual({ until: 'No programmes ahead', matched: '' });
    expect(readText(en, row({}))).toEqual({ until: 'No programmes ahead', matched: '' });
    expect(readText(en, row({ until: UNTIL, summary: summary(0, 0) })).matched).toBe('Channels matched: 0 of 0 (0%)');
  });
});
