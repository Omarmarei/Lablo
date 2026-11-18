import { describe, expect, it } from 'vitest';
import { backupRequest } from './backup-request';

const BUILD = { platform: 'webos', appId: 'com.lablo.iptv' };

/** A platform whose deviceSecret answers `answer`, counting the calls. */
function platform(answer: () => Promise<string | null>) {
  let calls = 0;
  return {
    calls: () => calls,
    deviceSecret: () => {
      calls++;
      return answer();
    },
  };
}

describe('backupRequest', () => {
  it('reads the device ID after "Allow" and passes it with the build', async () => {
    const p = platform(() => Promise.resolve('LGUDID-1'));
    expect(await backupRequest(p, true, BUILD)).toEqual({ platform: 'webos', appId: 'com.lablo.iptv', secret: 'LGUDID-1' });
    expect(p.calls()).toBe(1);
  });

  it.each([
    ['"Not now"', false],
    ['no answer yet', null],
  ])('never reads the device ID with %s, and asks for the backup code', async (_, consent) => {
    const p = platform(() => Promise.resolve('LGUDID-1'));
    expect(await backupRequest(p, consent, { platform: 'tizen', appId: 'LabloIPTV1.Lablo' })).toEqual({ platform: 'tizen', appId: 'LabloIPTV1.Lablo', secret: null });
    expect(p.calls()).toBe(0);
  });

  it.each([
    ['no ID', () => Promise.resolve(null)],
    ['an empty ID', () => Promise.resolve('')],
    ['a blank ID', () => Promise.resolve('   ')],
    ['an ID that is not text', () => Promise.resolve(42 as unknown as string)],
    ['a refusal', () => Promise.reject(new Error('denied'))],
  ])('asks for the backup code when the platform gives %s', async (_, answer) => {
    const p = platform(answer);
    expect(await backupRequest(p, true, BUILD)).toEqual({ ...BUILD, secret: null });
    expect(p.calls()).toBe(1);
  });

  it('asks for the backup code when the platform throws instead of answering', async () => {
    const p = {
      deviceSecret: (): Promise<string | null> => {
        throw new Error('no webapis');
      },
    };
    expect(await backupRequest(p, true, BUILD)).toEqual({ ...BUILD, secret: null });
  });

  it('keeps the ID as the platform gives it', async () => {
    const p = platform(() => Promise.resolve(' Q3CNHKHUDLN5W '));
    expect((await backupRequest(p, true, BUILD)).secret).toBe(' Q3CNHKHUDLN5W ');
  });
});
