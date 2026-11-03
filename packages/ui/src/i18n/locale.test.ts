import { describe, expect, it } from 'vitest';
import { localeDir } from './locale';

describe('localeDir', () => {
  it.each([
    ['ar-SA', 'rtl'],
    ['ar', 'rtl'],
    ['AR-ae', 'rtl'],
    ['fa-IR', 'rtl'],
    ['he', 'rtl'],
    ['en-US', 'ltr'],
    ['en', 'ltr'],
    ['en-XA', 'ltr'],
    ['arn-CL', 'ltr'],
    ['', 'ltr'],
  ])('%s -> %s', (locale, dir) => {
    expect(localeDir(locale)).toBe(dir);
  });
});
