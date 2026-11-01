/**
 * The device commands behind `pnpm device`, as plain argument lists so they can be tested
 * without a TV. webOS uses the ares-* CLI from @webos-tools/cli (installed with the repo);
 * Tizen uses the `tizen` and `sdb` CLIs from Tizen Studio (installed by hand, see
 * docs/runbooks/tv-build.md).
 */
export type DevicePlatform = 'webos' | 'tizen';
export type DeviceAction = 'devices' | 'install' | 'launch' | 'inspect';

export const DEVICE_ACTIONS: readonly DeviceAction[] = ['devices', 'install', 'launch', 'inspect'];
export const DEVICE_PLATFORMS: readonly DevicePlatform[] = ['webos', 'tizen'];

export interface DeviceCommand {
  /** An ares-* script name (run with Node from @webos-tools/cli), or `tizen` / `sdb` (run from PATH). */
  readonly bin: 'ares-setup-device' | 'ares-install' | 'ares-launch' | 'ares-inspect' | 'tizen' | 'sdb';
  readonly args: readonly string[];
}

export interface AppTarget {
  /** webOS app id (appinfo.json `id`) or Tizen application id (config.xml `tizen:application id`). */
  readonly appId: string;
  /** The package to install: the .ipk or .wgt in dist/packages. */
  readonly packageFile: string;
}

/**
 * `device` is the ares device name (`ares-setup-device`) on webOS, or the sdb serial
 * (`sdb devices`, e.g. `192.168.1.20:26101`) on Tizen. It is not needed for `devices`.
 */
export function deviceCommand(
  action: DeviceAction,
  platform: DevicePlatform,
  device: string,
  app: AppTarget,
): DeviceCommand {
  if (platform === 'webos') {
    switch (action) {
      case 'devices':
        return { bin: 'ares-setup-device', args: ['--list'] };
      case 'install':
        return { bin: 'ares-install', args: ['--device', device, app.packageFile] };
      case 'launch':
        return { bin: 'ares-launch', args: ['--device', device, app.appId] };
      case 'inspect':
        return { bin: 'ares-inspect', args: ['--device', device, '--app', app.appId, '--open'] };
    }
  }
  switch (action) {
    case 'devices':
      return { bin: 'sdb', args: ['devices'] };
    case 'install':
      return { bin: 'tizen', args: ['install', '-n', basename(app.packageFile), '-t', device, '--', dirname(app.packageFile)] };
    case 'launch':
      return { bin: 'tizen', args: ['run', '-p', app.appId, '-t', device] };
    case 'inspect':
      // Prints the remote-inspector port; open http://<tv-ip>:<port> in Chrome.
      return { bin: 'sdb', args: ['-s', device, 'shell', '0', 'debug', app.appId] };
  }
}

function basename(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}

function dirname(file: string): string {
  const parts = file.split(/[\\/]/);
  parts.pop();
  return parts.join('/') || '.';
}
