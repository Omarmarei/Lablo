import { PAIR_STATUSES, pairStatusFits } from '@lablo/protocol';
import { AR, EN } from '../src/phone/catalog';
import { PHONE_CSP } from '../next.config';
import { alert, endCode, expect, openQr, phone, plain, shot, test } from './support';

/**
 * The phone page `/p` against `next start` (RELAY step 31b's "Done when"): the QR link and the
 * typed code both send a payload that opens, with the TV's secret key, to exactly the typed
 * source; the progress shows each state and each TV status; in English and Arabic. Each test
 * plays the TV over the API. The `requests` fixture checks every request went to the page's own
 * origin.
 */

test('the QR link: an Xtream login, sealed for the TV, then each state of the progress', async ({ page, tv, requests }) => {
  const set = await tv();
  const answer = await page.goto(set.qrPath);
  // The browser keeps the page's own origin: the policy that says so is on the page.
  expect(answer?.headers()['content-security-policy']).toBe(PHONE_CSP);
  expect(answer?.headers()['referrer-policy']).toBe('no-referrer');

  await expect(phone(page)).toHaveAttribute('data-view', 'form');
  await expect(phone(page)).toHaveAttribute('dir', 'ltr');
  // The fragment is read, then gone from the address bar; the key came from it, not the server.
  expect(new URL(page.url()).hash).toBe('');
  expect(requests.some((url) => new URL(url).pathname === `/v1/pair/${set.code}`)).toBe(false);
  expect(requests.some((url) => url.includes(set.tvPk))).toBe(false);
  await expect(page.getByTestId('form-code')).toContainText(`${set.code.slice(0, 4)} ${set.code.slice(4)}`);

  await page.locator('#server').fill('  Example.COM:8080/ ');
  await page.locator('#username').fill(' user1 ');
  await page.locator('#password').fill('p@ss w0rd!');
  await page.locator('#epg0').fill('https://epg.example/guide.xml.gz');
  await page.locator('#name').fill(' Living room ');
  await shot(page, 'phone-form-en');
  await page.getByTestId('send').click();

  const progress = page.getByTestId('progress');
  await expect(progress).toHaveAttribute('data-state', 'sent');
  await expect(progress).toHaveText(EN['progress.sentWaiting']);
  // A new view takes the focus to its heading (a screen reader starts there).
  await expect(page.locator('h1')).toBeFocused();
  await shot(page, 'phone-progress-en');

  expect(await set.receive()).toEqual({
    v: 1,
    source: { type: 'xtream', server: 'http://example.com:8080/', username: 'user1', password: 'p@ss w0rd!' },
    name: 'Living room',
    epg: ['https://epg.example/guide.xml.gz'],
  });
  await expect(progress).toHaveAttribute('data-state', 'received');
  await expect(progress).toHaveText(EN['progress.receivedChecking']);

  await set.report('ok');
  const result = page.getByTestId('result');
  await expect(result).toHaveAttribute('data-status', 'ok');
  await expect(result).toHaveText(EN['done.ok']);
  await expect(page.locator('h1')).toHaveText(EN['done.okTitle']);
  await shot(page, 'phone-done-en');

  // "Add another source": a new code, the form empty.
  await page.getByRole('button', { name: EN['done.another'] }).click();
  await expect(phone(page)).toHaveAttribute('data-view', 'code');
});

test.describe('in Arabic', () => {
  test.use({ locale: 'ar-SA' });

  test('a typed code: an M3U link with two guide links and a name', async ({ page, tv, requests }) => {
    const set = await tv();
    await page.goto('/p');
    await expect(phone(page)).toHaveAttribute('data-view', 'code');
    await expect(phone(page)).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('h1')).toHaveText(AR['code.title'] as string);
    await shot(page, 'phone-code-ar');

    // As a person might type it: lower case, a dash between the halves.
    await page.locator('#code').fill(`${set.code.slice(0, 4).toLowerCase()}-${set.code.slice(4).toLowerCase()}`);
    await page.locator('#code').press('Enter');
    await expect(phone(page)).toHaveAttribute('data-view', 'form');
    // The typed path asks the server for the TV's key.
    expect(requests.some((url) => new URL(url).pathname === `/v1/pair/${set.code}`)).toBe(true);

    await page.locator('input[name="source-type"][value="m3u"]').check();
    await page.locator('#playlist').fill('HTTPS://Lists.Example/get.php?username=a&password=b&type=m3u_plus');
    await page.locator('#epg0').fill('lists.example/epg.xml');
    await page.getByRole('button', { name: AR['field.epgAdd'] as string }).click();
    await page.locator('#epg1').fill('https://second.example/guide.xml');
    await page.locator('#name').fill('غرفة الجلوس');
    await shot(page, 'phone-form-ar');
    await page.getByTestId('send').click();

    await expect(page.getByTestId('progress')).toHaveAttribute('data-state', 'sent');
    await expect(page.getByTestId('progress')).toHaveText(AR['progress.sentWaiting'] as string);
    expect(await set.receive()).toEqual({
      v: 1,
      source: { type: 'm3u', url: 'https://lists.example/get.php?username=a&password=b&type=m3u_plus' },
      name: 'غرفة الجلوس',
      epg: ['http://lists.example/epg.xml', 'https://second.example/guide.xml'],
    });
    await expect(page.getByTestId('progress')).toHaveAttribute('data-state', 'received');
    await shot(page, 'phone-progress-ar');

    await set.report('auth_failed');
    await expect(page.getByTestId('result')).toHaveAttribute('data-status', 'auth_failed');
    await expect(page.getByTestId('result')).toHaveText(AR['done.auth_failed'] as string);
    await shot(page, 'phone-done-failed-ar');

    // "Fix and send again": a new code, the values kept.
    await page.getByRole('button', { name: AR['done.fix'] as string }).click();
    const again = await tv();
    await page.locator('#code').fill(again.code);
    await page.locator('#code').press('Enter');
    await expect(page.locator('#playlist')).toHaveValue('HTTPS://Lists.Example/get.php?username=a&password=b&type=m3u_plus');
    await expect(page.locator('#name')).toHaveValue('غرفة الجلوس');
  });

  test('the TV statuses in Arabic', async ({ page, tv }) => {
    for (const status of ['ok', 'blocked'] as const) {
      const set = await tv();
      await openQr(page, set);
      await page.locator('input[name="source-type"][value="m3u"]').check();
      await page.locator('#playlist').fill('https://lists.example/a.m3u');
      await page.getByTestId('send').click();
      await set.receive();
      await set.report(status);
      await expect(page.getByTestId('result')).toHaveAttribute('data-status', status);
      await expect(page.getByTestId('result')).toHaveText(AR[`done.${status}`] as string);
      if (status === 'ok') await shot(page, 'phone-done-ar');
    }
  });
});

test('every TV status of an add, in English', async ({ page, tv }) => {
  for (const status of PAIR_STATUSES.filter((one) => pairStatusFits('add', one))) {
    const set = await tv();
    await openQr(page, set);
    await page.locator('input[name="source-type"][value="m3u"]').check();
    await page.locator('#playlist').fill('https://lists.example/a.m3u');
    await page.getByTestId('send').click();
    await set.receive();
    await set.report(status);
    await expect(page.getByTestId('result')).toHaveAttribute('data-status', status);
    await expect(page.getByTestId('result')).toHaveText(EN[`done.${status}`]);
    await expect(page.locator('h1')).toHaveText(status === 'ok' ? EN['done.okTitle'] : EN['done.failedTitle']);
  }
});

test.describe('the PIN’s login check (RELAY step 38c4)', () => {
  test('the QR link: the login alone, sealed for the TV, then the match', async ({ page, tv, requests }) => {
    const set = await tv('check');
    await openQr(page, set);
    await expect(phone(page)).toHaveAttribute('data-view', 'form');
    // The purpose came with the fragment: the server wasn't asked for the key.
    expect(requests.some((url) => new URL(url).pathname === `/v1/pair/${set.code}`)).toBe(false);
    await expect(page.locator('section[data-purpose]')).toHaveAttribute('data-purpose', 'check');
    await expect(page.locator('h1')).toHaveText(EN['check.title']);
    await expect(page.getByText(EN['check.body'])).toBeVisible();
    // The login and the link only: no file, no guide links, no name.
    await expect(page.locator('input[name="source-type"]')).toHaveCount(2);
    await expect(page.locator('input[name="source-type"][value="file"]')).toHaveCount(0);
    await expect(page.getByTestId('epg')).toHaveCount(0);
    await expect(page.locator('#name')).toHaveCount(0);

    await page.locator('#server').fill('panel.example:8080');
    await page.locator('#username').fill(' user1 ');
    await page.locator('#password').fill('secret');
    await shot(page, 'phone-check-form-en');
    await page.getByTestId('send').click();
    await expect(page.getByTestId('progress')).toHaveAttribute('data-state', 'sent');
    expect(await set.receive()).toEqual({ v: 1, source: { type: 'xtream', server: 'http://panel.example:8080', username: 'user1', password: 'secret' } });
    await expect(page.getByTestId('progress')).toHaveText(EN['progress.receivedLogin']);

    await set.report('match');
    await expect(page.getByTestId('result')).toHaveAttribute('data-status', 'match');
    await expect(page.getByTestId('result')).toHaveText(EN['done.match']);
    await expect(page.locator('h1')).toHaveText(EN['done.matchTitle']);
    // The TV takes it from here: nothing to press.
    await expect(phone(page).getByRole('button', { name: EN['done.fix'] })).toHaveCount(0);
    await expect(phone(page).getByRole('button', { name: EN['done.another'] })).toHaveCount(0);
    await shot(page, 'phone-check-match-en');
  });

  test.describe('in Arabic', () => {
    test.use({ locale: 'ar-SA' });

    test('a typed code: the link, no match, then fixed with a new code', async ({ page, tv }) => {
      const set = await tv('check');
      await page.goto('/p');
      await page.locator('#code').fill(set.code);
      await page.locator('#code').press('Enter');
      await expect(phone(page)).toHaveAttribute('data-view', 'form');
      // The typed path's purpose is the server's.
      await expect(page.locator('h1')).toHaveText(AR['check.title'] as string);
      await expect(page.locator('input[name="source-type"]')).toHaveCount(2);
      await page.locator('input[name="source-type"][value="m3u"]').check();
      await page.locator('#playlist').fill('lists.example/get.php?username=a&password=b');
      await shot(page, 'phone-check-form-ar');
      await page.getByTestId('send').click();
      expect(await set.receive()).toEqual({ v: 1, source: { type: 'm3u', url: 'http://lists.example/get.php?username=a&password=b' } });
      await expect(page.getByTestId('progress')).toHaveText(AR['progress.receivedLogin'] as string);

      await set.report('no_match');
      await expect(page.getByTestId('result')).toHaveAttribute('data-status', 'no_match');
      await expect(page.getByTestId('result')).toHaveText(AR['done.no_match'] as string);
      await expect(page.locator('h1')).toHaveText(AR['done.noMatchTitle'] as string);
      await shot(page, 'phone-check-no-match-ar');

      // "Fix and send again": the link kept for the next code.
      await page.getByRole('button', { name: AR['done.fix'] as string }).click();
      const again = await tv('check');
      await page.locator('#code').fill(again.code);
      await page.locator('#code').press('Enter');
      await expect(page.locator('#playlist')).toHaveValue('lists.example/get.php?username=a&password=b');
    });
  });
});

test('codes that don’t work: malformed, unknown, used, ended while the form was filled', async ({ page, tv, request, address }) => {
  await page.goto('/p');
  const code = page.locator('#code');
  const error = alert(page);

  await code.fill('ABC');
  await code.press('Enter');
  await expect(error).toHaveAttribute('data-error', 'format');
  expect(plain((await error.textContent()) ?? '')).toBe(plain(EN['code.format'].replace('{example}', '7K3M Q9XD')));

  await code.fill('ZZZZ ZZZZ');
  await code.press('Enter');
  await expect(error).toHaveAttribute('data-error', 'unknown');
  await expect(error).toHaveText(EN['code.unknown']);

  // A code whose payload was sent: the QR link shows its progress, not the form.
  const used = await tv();
  await openQr(page, used);
  await page.locator('input[name="source-type"][value="m3u"]').check();
  await page.locator('#playlist').fill('https://lists.example/a.m3u');
  await page.getByTestId('send').click();
  await expect(page.getByTestId('progress')).toHaveAttribute('data-state', 'sent');
  await openQr(page, used);
  await expect(page.getByTestId('progress')).toHaveAttribute('data-state', 'sent');

  // The code ends while the form is filled: a new code sends the same values.
  const first = await tv();
  await openQr(page, first);
  await page.locator('#server').fill('provider.example:8000');
  await page.locator('#username').fill('kept');
  await page.locator('#password').fill('kept-too');
  await endCode(first.code);
  await page.getByTestId('send').click();
  await expect(phone(page)).toHaveAttribute('data-view', 'code');
  await expect(error).toHaveAttribute('data-error', 'ended');
  await expect(error).toHaveText(EN['code.ended']);
  const second = await tv();
  await code.fill(second.code);
  await code.press('Enter');
  await expect(page.locator('#username')).toHaveValue('kept');
  await page.getByTestId('send').click();
  expect(await second.receive()).toEqual({ v: 1, source: { type: 'xtream', server: 'http://provider.example:8000', username: 'kept', password: 'kept-too' } });

  // A QR link to an ended code.
  const ended = await tv();
  await endCode(ended.code);
  await openQr(page, ended);
  await expect(error).toHaveAttribute('data-error', 'ended');

  // Too many guesses from this address: the page says how long to wait.
  for (let i = 0; i < 30; i++) {
    const answer = await request.get('/v1/pair/ZZZZZZZZ', { headers: { 'x-forwarded-for': address } });
    if (answer.status() === 429) break;
  }
  await code.fill('ZZZZ ZZZZ');
  await code.press('Enter');
  await expect(error).toHaveAttribute('data-error', 'limited');
  await expect(error).toHaveText(/Try again in (10|9) minutes\./);
});

test('the language toggle keeps what was typed', async ({ page, tv }) => {
  const set = await tv();
  await page.goto(set.qrPath);
  await page.locator('#server').fill('provider.example');
  await page.locator('#username').fill('someone');
  await page.getByTestId('lang').click();
  await expect(phone(page)).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page).toHaveTitle(AR['meta.title'] as string);
  expect(new URL(page.url()).searchParams.get('lang')).toBe('ar');
  await expect(page.locator('h1')).toHaveText(AR['form.title'] as string);
  await expect(page.locator('#server')).toHaveValue('provider.example');
  await expect(page.locator('#username')).toHaveValue('someone');
  await page.getByTestId('send').click();
  // The password is missing: the problem shows in Arabic, on the field.
  await expect(page.locator('#password-problem')).toHaveText(AR['field.required'] as string);
  await expect(page.locator('#password')).toBeFocused();
  await shot(page, 'phone-problems-ar');
  await page.getByTestId('lang').click();
  await expect(page.locator('#password-problem')).toHaveText(EN['field.required']);
  await expect(phone(page)).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

  // Another TV's QR link opened in this tab: only the fragment changes, and the page starts again.
  const next = await tv();
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, next.qrPath.slice(next.qrPath.indexOf('#')));
  await expect(page.getByTestId('form-code')).toContainText(`${next.code.slice(0, 4)} ${next.code.slice(4)}`);
  await expect(page.locator('#server')).toHaveValue('');
  expect(new URL(page.url()).hash).toBe('');
});

test('the server renders the language before any script runs', async ({ request, address }) => {
  const html = async (path: string, acceptLanguage: string): Promise<string> => {
    const answer = await request.get(path, { headers: { 'accept-language': acceptLanguage, 'x-forwarded-for': address } });
    expect(answer.status()).toBe(200);
    return answer.text();
  };
  const arabic = await html('/p', 'ar-SA,ar;q=0.9,en;q=0.8');
  expect(arabic).toContain('<html lang="ar" dir="rtl"');
  expect(arabic).toContain('<div class="phone" lang="ar" dir="rtl" data-testid="phone" data-view="starting">');
  expect(arabic).toContain(`<title>${AR['meta.title'] as string}</title>`);
  expect(arabic).toContain('<meta name="robots" content="noindex, nofollow"/>');

  // `?lang` wins for the page; the document follows once the page runs.
  const asked = await html('/p?lang=ar', 'en-US,en;q=0.9');
  expect(asked).toContain('<html lang="en" dir="ltr"');
  expect(asked).toContain('<div class="phone" lang="ar" dir="rtl"');
  expect(asked).toContain(`<title>${AR['meta.title'] as string}</title>`);

  const english = await html('/p?lang=en', 'ar');
  expect(english).toContain('<div class="phone" lang="en" dir="ltr"');
  expect(english).toContain(`<title>${EN['meta.title']}</title>`);
  expect(await html('/p', 'de-DE,fr;q=0.5')).toContain('<div class="phone" lang="en" dir="ltr"');
});
