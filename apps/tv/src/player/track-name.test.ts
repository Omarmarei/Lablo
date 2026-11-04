import type { PlayerTrack } from '@zoma/player';
import { describe, expect, it } from 'vitest';
import { appI18n } from '../i18n';
import { extraLabel, trackName } from './TrackMenuPanel';

const track = (lang: string, streamLang: string): PlayerTrack => ({ id: '0', lang, streamLang, label: '', selected: false });

describe('trackName (RELAY step 20b)', () => {
  const en = appI18n('en-US');
  const ar = appI18n('ar-SA');

  it("names a language the catalogs know in the UI's words", () => {
    expect(trackName(en, track('ar', 'ara'), 0)).toEqual({ text: 'Arabic', provider: false });
    expect(trackName(ar, track('en', 'eng'), 0)).toEqual({ text: 'الإنجليزية', provider: false });
    expect(trackName(en, track('tl', 'fil'), 3)).toEqual({ text: 'Filipino', provider: false });
  });

  it('shows any other language as the stream wrote it (provider text)', () => {
    expect(trackName(en, track('kok', 'kok'), 0)).toEqual({ text: 'kok', provider: true });
    expect(trackName(ar, track('', ' Klingon '), 0)).toEqual({ text: 'Klingon', provider: true });
  });

  it('numbers a track with no language from 1', () => {
    expect(trackName(en, track('', ''), 0)).toEqual({ text: 'Track 1', provider: false });
    expect(trackName(en, track('', '  '), 2)).toEqual({ text: 'Track 3', provider: false });
    expect(trackName(ar, track('', ''), 1).text).toMatch(/^المسار .*2/);
  });

  it("doesn't take an inherited property for a language", () => {
    expect(trackName(en, track('constructor', 'constructor'), 0)).toEqual({ text: 'constructor', provider: true });
  });
});

describe('extraLabel (RELAY step 20b)', () => {
  const labelled = (lang: string, streamLang: string, label: string): PlayerTrack => ({ id: '0', lang, streamLang, label, selected: false });

  it('drops a label that only names the language again', () => {
    expect(extraLabel(labelled('ar', 'ara', 'العربية'), 'Arabic')).toBe('');
    expect(extraLabel(labelled('es', 'spa', ' Español '), 'Spanish')).toBe('');
    expect(extraLabel(labelled('en', 'eng', 'english'), 'English')).toBe('');
    expect(extraLabel(labelled('', 'xx', 'XX'), 'XX')).toBe('');
    expect(extraLabel(labelled('en', 'eng', ''), 'English')).toBe('');
  });

  it('keeps a label that says more, or names another language', () => {
    expect(extraLabel(labelled('en', 'eng', 'English 5.1 (AC3)'), 'English')).toBe('English 5.1 (AC3)');
    expect(extraLabel(labelled('en', 'eng', 'Commentary'), 'English')).toBe('Commentary');
    expect(extraLabel(labelled('en', 'eng', 'Arabic'), 'English')).toBe('Arabic');
    expect(extraLabel(labelled('', '', 'Audio Track'), 'Track 1')).toBe('Audio Track');
    expect(extraLabel(labelled('', '', 'English'), 'Track 1')).toBe('English');
  });
});
