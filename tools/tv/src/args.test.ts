import { describe, expect, it } from 'vitest';
import { parseTvArgs, TV_COMMANDS, USAGE, WEBOS_COMMANDS } from './args';

describe('parseTvArgs', () => {
  it('reads the command, its words and the defaults', () => {
    expect(parseTvArgs(['keys', 'KEY_UP', '800', 'TEXT:a'])).toEqual({ command: 'keys', words: ['KEY_UP', '800', 'TEXT:a'], lab: false, webos: false, minutes: 120, everySeconds: 60 });
    expect(parseTvArgs(['marks'])).toEqual({ command: 'marks', words: [], lab: false, webos: false, minutes: 120, everySeconds: 60 });
  });

  it('knows uninstall, with --lab', () => {
    expect(parseTvArgs(['uninstall', '--lab'])).toEqual({ command: 'uninstall', words: [], lab: true, webos: false, minutes: 120, everySeconds: 60 });
    expect(USAGE).toContain('uninstall');
  });

  it('takes the flags anywhere', () => {
    expect(parseTvArgs(['--lab', 'launch'])).toEqual({ command: 'launch', words: [], lab: true, webos: false, minutes: 120, everySeconds: 60 });
    expect(parseTvArgs(['soak', '--port', '9222', 'watch', '--minutes', '480', '--every', '30'])).toEqual({
      command: 'soak',
      words: ['watch'],
      lab: false,
      webos: false,
      port: 9222,
      minutes: 480,
      everySeconds: 30,
    });
    expect(parseTvArgs(['eval', '--port', '65535', '1+1'])).toMatchObject({ port: 65_535, words: ['1+1'] });
    expect(parseTvArgs(['eval', '--port', '1', 'x'])).toMatchObject({ port: 1 });
    expect(parseTvArgs(['soak', 'watch', '--minutes', '1', '--every', '1'])).toMatchObject({ minutes: 1, everySeconds: 1 });
  });

  it('refuses a bad number', () => {
    for (const flag of ['--port', '--minutes', '--every']) {
      for (const value of ['0', '-1', '1.5', 'x']) expect(parseTvArgs(['soak', flag, value])).toBe(`${flag} needs a whole number above 0`);
      expect(parseTvArgs(['soak', flag])).toBe(`${flag} needs a whole number above 0`);
    }
    expect(parseTvArgs(['eval', '--port', '65536'])).toBe('--port needs a port number');
    expect(parseTvArgs(['soak', '--minutes', '65536'])).toMatchObject({ minutes: 65_536 });
  });

  it('takes --webos for the inspector commands only (step 56)', () => {
    expect(parseTvArgs(['inspect', '--webos', 'tv', '--lab'])).toEqual({ command: 'inspect', words: ['tv'], lab: true, webos: true, minutes: 120, everySeconds: 60 });
    expect(parseTvArgs(['soak', 'watch', '--port', '9229', '--webos'])).toMatchObject({ command: 'soak', words: ['watch'], webos: true, port: 9229 });
    expect(WEBOS_COMMANDS).toEqual(['inspect', 'eval', 'screen', 'marks', 'soak']);
    for (const command of WEBOS_COMMANDS) expect(parseTvArgs([command, '--webos'])).toMatchObject({ command, webos: true });
    for (const command of TV_COMMANDS.filter((c) => !WEBOS_COMMANDS.includes(c))) {
      const refused = parseTvArgs(['--webos', command]);
      expect(refused).toBe(
        `pnpm tv ${command} drives the Samsung only (sdb, its remote, its REST API). On an LG TV: pnpm device launch|install webos <tv> [--lab], and ares-install --device <tv> --remove <app id>.`,
      );
      expect(parseTvArgs([command])).toMatchObject({ command, webos: false });
    }
    expect(parseTvArgs(['--webos'])).toBe(USAGE);
    expect(USAGE).toContain('inspect --webos <ares device>');
  });

  it('answers the usage for no command or an unknown one', () => {
    expect(parseTvArgs([])).toBe(USAGE);
    expect(parseTvArgs(['press'])).toBe(USAGE);
    expect(parseTvArgs(['--lab'])).toBe(USAGE);
    for (const command of TV_COMMANDS) expect(USAGE).toContain(`  ${command}`);
  });
});
