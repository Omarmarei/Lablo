import { describe, expect, it } from 'vitest';
import { deviceCommand } from './commands';

const webosApp = { appId: 'com.zoma.iptv', packageFile: 'D:/repo/dist/packages/com.zoma.iptv_0.1.0_all.ipk' };
const tizenApp = { appId: 'ZomaIPTV01.Zoma', packageFile: 'D:\\repo\\dist\\packages\\Zoma.wgt' };

describe('webOS device commands (ares-*)', () => {
  it('lists configured devices', () => {
    expect(deviceCommand('devices', 'webos', '', webosApp)).toEqual({ bin: 'ares-setup-device', args: ['--list'] });
  });

  it('installs the .ipk on the named device', () => {
    expect(deviceCommand('install', 'webos', 'livingroom', webosApp)).toEqual({
      bin: 'ares-install',
      args: ['--device', 'livingroom', 'D:/repo/dist/packages/com.zoma.iptv_0.1.0_all.ipk'],
    });
  });

  it('launches and inspects by app id', () => {
    expect(deviceCommand('launch', 'webos', 'tv', webosApp)).toEqual({
      bin: 'ares-launch',
      args: ['--device', 'tv', 'com.zoma.iptv'],
    });
    expect(deviceCommand('inspect', 'webos', 'tv', webosApp)).toEqual({
      bin: 'ares-inspect',
      args: ['--device', 'tv', '--app', 'com.zoma.iptv', '--open'],
    });
  });
});

describe('Tizen device commands (tizen / sdb)', () => {
  it('lists connected devices', () => {
    expect(deviceCommand('devices', 'tizen', '', tizenApp)).toEqual({ bin: 'sdb', args: ['devices'] });
  });

  // The device is always the sdb serial: `tizen install|run` take it with `-s` (`-t` is the
  // target *name*, a different column of `sdb devices`), and sdb itself with `-s`.
  it('installs the .wgt by name from its folder (Windows paths too)', () => {
    expect(deviceCommand('install', 'tizen', '192.168.1.20:26101', tizenApp)).toEqual({
      bin: 'tizen',
      args: ['install', '-n', 'Zoma.wgt', '-s', '192.168.1.20:26101', '--', 'D:/repo/dist/packages'],
    });
  });

  it('launches with tizen run and inspects with sdb debug', () => {
    expect(deviceCommand('launch', 'tizen', '192.168.1.20:26101', tizenApp)).toEqual({
      bin: 'tizen',
      args: ['run', '-p', 'ZomaIPTV01.Zoma', '-s', '192.168.1.20:26101'],
    });
    expect(deviceCommand('inspect', 'tizen', '192.168.1.20:26101', tizenApp)).toEqual({
      bin: 'sdb',
      args: ['-s', '192.168.1.20:26101', 'shell', '0', 'debug', 'ZomaIPTV01.Zoma'],
    });
  });
});
