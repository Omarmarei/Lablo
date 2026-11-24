import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { deviceCommand, tizenManifest, tizenPackageName } from './commands';

const webosApp = { appId: 'com.lablo.iptv', packageFile: 'D:/repo/dist/packages/com.lablo.iptv_0.1.0_all.ipk' };
const tizenApp = { appId: 'LabloIPTV1.Lablo', packageFile: 'D:\\repo\\dist\\packages\\Lablo.wgt' };

describe('webOS device commands (ares-*)', () => {
  it('lists configured devices', () => {
    expect(deviceCommand('devices', 'webos', '', webosApp)).toEqual({ bin: 'ares-setup-device', args: ['--list'] });
  });

  it('installs the .ipk on the named device', () => {
    expect(deviceCommand('install', 'webos', 'livingroom', webosApp)).toEqual({
      bin: 'ares-install',
      args: ['--device', 'livingroom', 'D:/repo/dist/packages/com.lablo.iptv_0.1.0_all.ipk'],
    });
  });

  it('launches and inspects by app id', () => {
    expect(deviceCommand('launch', 'webos', 'tv', webosApp)).toEqual({
      bin: 'ares-launch',
      args: ['--device', 'tv', 'com.lablo.iptv'],
    });
    expect(deviceCommand('inspect', 'webos', 'tv', webosApp)).toEqual({
      bin: 'ares-inspect',
      args: ['--device', 'tv', '--app', 'com.lablo.iptv', '--open'],
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
      args: ['install', '-n', 'Lablo.wgt', '-s', '192.168.1.20:26101', '--', 'D:/repo/dist/packages'],
    });
  });

  it('launches with tizen run and inspects with sdb debug', () => {
    expect(deviceCommand('launch', 'tizen', '192.168.1.20:26101', tizenApp)).toEqual({
      bin: 'tizen',
      args: ['run', '-p', 'LabloIPTV1.Lablo', '-s', '192.168.1.20:26101'],
    });
    expect(deviceCommand('inspect', 'tizen', '192.168.1.20:26101', tizenApp)).toEqual({
      bin: 'sdb',
      args: ['-s', '192.168.1.20:26101', 'shell', '0', 'debug', 'LabloIPTV1.Lablo'],
    });
  });
});

// The TV refused `Lablo Lab.wgt`, and a listing matched by `/lab/i` found `Lablo.wgt` for the
// lab too (RELAY step 39s5): the package is named exactly, from the manifest.
describe('the Tizen package names', () => {
  const app = readFileSync(path.resolve(import.meta.dirname, '../../../platforms/tizen/config.xml'), 'utf8');
  // The lab's manifest as tools/build/src/lab.ts writes it: its own ids and name.
  const lab = app
    .replace('id="LabloIPTV1.Lablo" package="LabloIPTV1"', 'id="LabloLab01.LabloLab" package="LabloLab01"')
    .replace('<name>Lablo</name>', '<name>Lablo Lab</name>');

  it('are the widget names without spaces, beside the application ids', () => {
    expect(tizenPackageName(app)).toBe('Lablo.wgt');
    expect(tizenPackageName(lab)).toBe('LabloLab.wgt');
    expect(tizenManifest(app)).toEqual({ appId: 'LabloIPTV1.Lablo', packageName: 'Lablo.wgt' });
    expect(tizenManifest(lab)).toEqual({ appId: 'LabloLab01.LabloLab', packageName: 'LabloLab.wgt' });
  });

  it('say what a manifest lacks', () => {
    expect(tizenManifest(app.replace('<name>Lablo</name>', ''))).toBe('no widget <name>');
    expect(tizenManifest(app.replace('<tizen:application id=', '<tizen:application package-id='))).toBe('no application id');
  });

  it('drop tabs and new lines, read a name with attributes, and take the first name', () => {
    expect(tizenPackageName('<widget><name xml:lang="en">\n\t Lablo  Lab \n</name></widget>')).toBe('LabloLab.wgt');
    expect(tizenPackageName('<widget><name>A</name><name>B</name></widget>')).toBe('A.wgt');
  });

  it('are null without a name', () => {
    expect(tizenPackageName('<widget/>')).toBeNull();
    expect(tizenPackageName('<widget><name> </name></widget>')).toBeNull();
    expect(tizenPackageName('<widget><names>Lablo</names></widget>')).toBeNull();
  });

  it('pass the lab package by its name, and a folder with spaces as one argument', () => {
    const lab = { appId: 'LabloLab01.LabloLab', packageFile: 'D:/Claude Code PlayGround/IPTV/dist/packages/LabloLab.wgt' };
    expect(deviceCommand('install', 'tizen', '192.168.1.20:26101', lab).args).toEqual([
      'install',
      '-n',
      'LabloLab.wgt',
      '-s',
      '192.168.1.20:26101',
      '--',
      'D:/Claude Code PlayGround/IPTV/dist/packages',
    ]);
  });
});
