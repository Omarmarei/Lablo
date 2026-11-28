import { describe, expect, it } from 'vitest';
import { chromiumMajorFromUserAgent, deviceTier } from './device';

describe('deviceTier', () => {
  it.each([
    [2018, null, 'low'],
    [2019, 120, 'low'], // the model year wins over the engine version
    [2020, null, 'full'],
    [2024, 53, 'full'],
    [null, 53, 'low'],
    [null, 63, 'low'],
    [null, 68, 'full'],
    [null, 120, 'full'],
    [null, null, 'full'], // ADR-015: both platforms start at 2020, so a set the tables don't know is newer
  ] as const)('year %s, Chromium %s -> %s', (modelYear, chromiumVersion, tier) => {
    expect(deviceTier({ modelYear, chromiumVersion })).toBe(tier);
  });
});

describe('chromiumMajorFromUserAgent', () => {
  it.each([
    // LG webOS 4 (2018)
    ['Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.34 Safari/537.36 WebAppManager', 53],
    // Samsung Tizen 5.5 (2020)
    ['Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.5) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/2.2 Chrome/69.0.3497.106 TV Safari/537.36', 69],
    // Playwright headless shell
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.7339.16 Safari/537.36', 140],
    // Samsung Tizen 5.5 (2020), the TV's own user agent: no Chrome token (spike S0, UA32T5300AUXEG)
    ['Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.5) AppleWebKit/537.36 (KHTML, like Gecko) 69.0.3497.106/5.5 TV Safari/537.36', null],
    // Older Tizen user agents carry no Chrome token
    ['Mozilla/5.0 (SMART-TV; LINUX; Tizen 4.0) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 TV Safari/537.36', null],
    ['', null],
  ])('%s -> %s', (userAgent, major) => {
    expect(chromiumMajorFromUserAgent(userAgent)).toBe(major);
  });
});
