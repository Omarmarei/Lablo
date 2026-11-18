import { FILE_FRAME_BYTES, fileCipherLength, fileFrameCount, fromBase64Url, openFile } from '@lablo/crypto';
import type { PairFile, PairPayload } from '@lablo/protocol';
import type { Page } from '@playwright/test';
import { AR, EN, FSI, PDI } from '../src/phone/catalog';
import type { Tv } from './support';
import { alert, expect, openQr, phone, shot, test } from './support';

/**
 * The phone page's M3U file (RELAY step 31d1) against `next start`: a file of three 1 MiB frames
 * chosen on the page, encrypted there, uploaded to the presigned URL (the memory store's path on
 * this origin) and announced in the sealed payload; the scripted TV gets the file's URL from the
 * API, downloads it and opens it to exactly the file; the blob is gone once the TV reports. In
 * English and Arabic. The `requests` fixture checks every request went to the page's own origin.
 */

/** An M3U playlist of at least `bytes` bytes, every line a marker that must never reach the server in the clear. */
function playlist(bytes: number): Buffer {
  const lines = ['#EXTM3U'];
  let size = 8;
  for (let i = 0; size < bytes; i += 1) {
    const entry = `#EXTINF:-1 tvg-id="marker.${i}" group-title="Marker group",Marker channel ${i}\nhttp://streams.marker.example:8080/live/marker-user/marker-pass/${i}.ts`;
    lines.push(entry);
    size += entry.length + 1;
  }
  return Buffer.from(`${lines.join('\n')}\n`);
}

const FILE = playlist(2 * FILE_FRAME_BYTES + 400_000);

/** Bytes as text, to look for the markers in. */
function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

/** The payload's file. */
function fileOf(payload: PairPayload): PairFile {
  expect(payload.source.type).toBe('m3u-file');
  return (payload.source as Extract<PairPayload['source'], { type: 'm3u-file' }>).file;
}

/**
 * The TV's side: the payload's file fetched by its presigned URL and opened with the payload's
 * keys to exactly `expected`; the stored bytes hold none of the file's text.
 */
async function receiveFile(set: Tv, payload: PairPayload, expected: Buffer): Promise<string> {
  const file = fileOf(payload);
  expect(file.size).toBe(expected.length);
  const url = await set.fileUrl();
  // Development's presigned URL is a path on the API's own origin.
  expect(url).toMatch(/^\/dev\/blob\/pair\/[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}\?m=GET&/);
  expect(url).toContain(file.key);
  const got = await set.download(url);
  expect(got.status).toBe(200);
  expect(got.cors).toBe('*');
  expect(got.bytes.length).toBe(fileCipherLength(expected.length));
  expect(latin1(got.bytes)).not.toContain('Marker');
  expect(latin1(got.bytes)).not.toContain('#EXTM3U');
  const opened = openFile(got.bytes, fromBase64Url(file.fileKey)!, fromBase64Url(file.base)!, file.size);
  expect(opened !== null && Buffer.from(opened).equals(expected), 'the file opens with the payload’s keys to exactly what was chosen').toBe(true);
  return url;
}

async function chooseFile(page: Page, name: string, buffer: Buffer): Promise<void> {
  await page.locator('input[name="source-type"][value="file"]').check();
  await page.locator('#file').setInputFiles({ name, mimeType: 'audio/x-mpegurl', buffer });
}

const plainText = (text: string | null): string => (text ?? '').split(FSI).join('').split(PDI).join('');

test('the QR link: a file of three frames, encrypted on the phone, opened by the TV', async ({ page, tv, requests }) => {
  expect(fileFrameCount(FILE.length)).toBe(3);
  const set = await tv();
  await page.goto(set.qrPath);
  await expect(phone(page)).toHaveAttribute('data-view', 'form');

  await chooseFile(page, 'Living room.m3u', FILE);
  // The name and the size, each isolated; the button now offers another file.
  await expect(page.getByTestId('file-chosen')).toHaveText(`${FSI}Living room.m3u${PDI}, ${FSI}${FSI}2.4${PDI} MB${PDI}`);
  await expect(page.locator('label[for="file"]')).toHaveText(EN['field.fileChange']);
  await page.locator('#epg0').fill('epg.example/guide.xml');
  await shot(page, 'phone-file-form-en');
  await page.getByTestId('send').click();

  const progress = page.getByTestId('progress');
  await expect(progress).toHaveAttribute('data-state', 'sent');
  // The upload went to this origin's development route, before the payload.
  const paths = requests.map((url) => new URL(url).pathname);
  const upload = paths.findIndex((path) => path.startsWith('/dev/blob/pair/'));
  expect(paths.indexOf(`/v1/pair/${set.code}/upload-url`)).toBeGreaterThan(-1);
  expect(upload).toBeGreaterThan(paths.indexOf(`/v1/pair/${set.code}/upload-url`));
  expect(paths.indexOf(`/v1/pair/${set.code}/payload`)).toBeGreaterThan(upload);

  const payload = await set.receive();
  expect(payload).toMatchObject({ v: 1, name: 'Living room', epg: ['http://epg.example/guide.xml'] });
  const url = await receiveFile(set, payload, FILE);
  await expect(progress).toHaveAttribute('data-state', 'received');

  await set.report('ok');
  await expect(page.getByTestId('result')).toHaveAttribute('data-status', 'ok');
  // The TV's status deleted the file.
  expect((await set.download(url)).status).toBe(404);
});

test.describe('in Arabic', () => {
  test.use({ locale: 'ar-SA' });

  test('a typed code: a file with a name, refused by the TV, then sent again with a new code', async ({ page, tv }) => {
    const set = await tv();
    await page.goto('/p');
    await page.locator('#code').fill(set.code);
    await page.locator('#code').press('Enter');
    await expect(phone(page)).toHaveAttribute('data-view', 'form');
    await expect(phone(page)).toHaveAttribute('dir', 'rtl');

    await chooseFile(page, 'قائمة.m3u8', FILE);
    await expect(page.getByTestId('file-chosen')).toContainText('قائمة.m3u8');
    await expect(page.getByTestId('file-chosen')).toContainText((AR['size.mb'] as string).replace('{n}', `${FSI}2.4${PDI}`));
    await page.locator('#name').fill('قائمتي');
    await shot(page, 'phone-file-form-ar');
    await page.getByTestId('send').click();
    await expect(page.getByTestId('progress')).toHaveAttribute('data-state', 'sent');
    await shot(page, 'phone-file-progress-ar');

    const first = await set.receive();
    expect(first.name).toBe('قائمتي');
    const firstUrl = await receiveFile(set, first, FILE);
    await set.report('unreachable');
    await expect(page.getByTestId('result')).toHaveAttribute('data-status', 'unreachable');
    // After a file, `unreachable` is a file the TV couldn't read (RELAY step 31d2b2b).
    await expect(page.getByTestId('result')).toHaveText(AR['done.unreachableFile'] as string);
    await shot(page, 'phone-file-unreachable-ar');
    expect((await set.download(firstUrl)).status).toBe(404);

    // "Fix and send again": the file is still chosen, and goes again under new keys.
    await page.getByRole('button', { name: AR['done.fix'] as string }).click();
    const again = await tv();
    await page.locator('#code').fill(again.code);
    await page.locator('#code').press('Enter');
    await expect(page.getByTestId('file-chosen')).toContainText('قائمة.m3u8');
    await page.getByTestId('send').click();
    const second = await again.receive();
    await receiveFile(again, second, FILE);
    expect(fileOf(second).fileKey).not.toBe(fileOf(first).fileKey);
    expect(fileOf(second).key).not.toBe(fileOf(first).key);
  });
});

test('a file the page refuses: none chosen, or an empty one; nothing is asked for', async ({ page, tv, requests }) => {
  const set = await tv();
  await openQr(page, set);
  await page.locator('input[name="source-type"][value="file"]').check();
  await page.getByTestId('send').click();
  await expect(page.locator('#file-problem')).toHaveText(EN['field.noFile']);
  await expect(page.locator('#file')).toBeFocused();
  await expect(alert(page)).toHaveAttribute('data-error', 'problems');

  await page.locator('#file').setInputFiles({ name: 'empty.m3u', mimeType: 'audio/x-mpegurl', buffer: Buffer.alloc(0) });
  await expect(page.locator('#file-problem')).toHaveText(EN['field.fileEmpty']);
  await page.getByTestId('send').click();
  await expect(phone(page)).toHaveAttribute('data-view', 'form');
  await shot(page, 'phone-file-problems-en');
  expect(plainText(await page.locator('#file-hint').textContent())).toBe('The M3U file your provider sent you, up to 40 MB');

  // A good file mends it.
  await page.locator('#file').setInputFiles({ name: 'small.m3u', mimeType: 'audio/x-mpegurl', buffer: Buffer.from('#EXTM3U\n') });
  await expect(page.locator('#file-problem')).toHaveCount(0);
  expect(requests.some((url) => url.includes('/upload-url') || url.includes('/dev/blob/'))).toBe(false);
});
