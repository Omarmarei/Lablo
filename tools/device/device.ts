/**
 * `pnpm device <action> <platform> [device]`: install, launch and inspect the TV builds.
 *
 *   pnpm device devices webos               ares-setup-device --list
 *   pnpm device install webos <name>        ares-install the .ipk from pnpm build:tv
 *   pnpm device launch  webos <name>
 *   pnpm device inspect webos <name>        remote DevTools (ares-inspect --open)
 *   pnpm device install tizen <serial>      needs Tizen Studio's `tizen` CLI on PATH
 *
 * Setting up a TV (Developer Mode, ares-setup-device, Samsung certificates) is in
 * docs/runbooks/tv-build.md.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { AppTarget, DeviceAction, DeviceCommand, DevicePlatform } from './src/commands';
import { DEVICE_ACTIONS, DEVICE_PLATFORMS, deviceCommand } from './src/commands';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PACKAGES = path.join(ROOT, 'dist/packages');
const require = createRequire(import.meta.url);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function appTarget(platform: DevicePlatform): AppTarget {
  if (platform === 'webos') {
    const appinfo = JSON.parse(readFileSync(path.join(ROOT, 'platforms/webos/appinfo.json'), 'utf8')) as { id: string };
    const version = (JSON.parse(readFileSync(path.join(ROOT, 'apps/tv/package.json'), 'utf8')) as { version: string })
      .version;
    return { appId: appinfo.id, packageFile: path.join(PACKAGES, `${appinfo.id}_${version}_all.ipk`) };
  }
  const config = readFileSync(path.join(ROOT, 'platforms/tizen/config.xml'), 'utf8');
  const appId = /<tizen:application\s+id="([^"]+)"/.exec(config)?.[1] ?? fail('No application id in config.xml');
  const wgt = existsSync(PACKAGES) ? readdirSync(PACKAGES).find((name) => name.endsWith('.wgt')) : undefined;
  return { appId, packageFile: path.join(PACKAGES, wgt ?? 'Zoma.wgt') };
}

function run(command: DeviceCommand): number {
  if (command.bin.startsWith('ares-')) {
    const script = require.resolve(`@webos-tools/cli/bin/${command.bin}.js`);
    return spawnSync(process.execPath, [script, ...command.args], { stdio: 'inherit' }).status ?? 1;
  }
  // tizen and sdb come from Tizen Studio; `tizen` is a .bat on Windows, so use a shell.
  const quoted = command.args.map((arg) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg));
  const probe = spawnSync(command.bin, ['version'], { shell: true, stdio: 'ignore' });
  if (probe.status !== 0) {
    fail(
      [
        `"${command.bin}" is not on PATH. Install the Tizen Studio CLI (docs/runbooks/tv-build.md), then run:`,
        `  ${command.bin} ${quoted.join(' ')}`,
      ].join('\n'),
    );
  }
  return spawnSync(command.bin, quoted, { shell: true, stdio: 'inherit' }).status ?? 1;
}

function main(): void {
  const [action, platform, device = ''] = process.argv.slice(2);
  const usage = `Usage: pnpm device <${DEVICE_ACTIONS.join('|')}> <${DEVICE_PLATFORMS.join('|')}> [device]`;
  if (!DEVICE_ACTIONS.includes(action as DeviceAction) || !DEVICE_PLATFORMS.includes(platform as DevicePlatform)) {
    fail(usage);
  }
  if (action !== 'devices' && device === '') fail(`${usage}\nName the device (ares device name or sdb serial).`);

  const app = appTarget(platform as DevicePlatform);
  if (action === 'install' && !existsSync(app.packageFile)) {
    const how =
      platform === 'tizen'
        ? 'Run pnpm build:tv with the Tizen CLI installed and TIZEN_SIGNING_PROFILE set (docs/runbooks/tv-build.md).'
        : 'Run pnpm build:tv first.';
    fail(`${path.relative(ROOT, app.packageFile)} does not exist. ${how}`);
  }
  process.exitCode = run(deviceCommand(action as DeviceAction, platform as DevicePlatform, device, app));
}

main();
