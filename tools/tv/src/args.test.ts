import { describe, expect, it } from 'vitest';
import { parseTvArgs, TV_COMMANDS, USAGE } from './args';

describe('parseTvArgs', () => {
  it('reads the command, its words and the defaults', () => {
    expect(parseTvArgs(['keys', 'KEY_UP', '800', 'TEXT:a'])).toEqual({ command: 'keys', words: ['KEY_UP', '800', 'TEXT:a'], lab: false, minutes: 120, everySeconds: 60 });
    expect(parseTvArgs(['marks'])).toEqual({ command: 'marks', words: [], lab: false, minutes: 120, everySeconds: 60 });
  });

  it('knows uninstall, with --lab', () => {
    expect(parseTvArgs(['uninstall', '--lab'])).toEqual({ command: 'uninstall', words: [], lab: true, minutes: 120, everySeconds: 60 });
    expect(USAGE).toContain('uninstall');
  });

  it('takes the flags anywhere', () => {
    expect(parseTvArgs(['--lab', 'launch'])).toEqual({ command: 'launch', words: [], lab: true, minutes: 120, everySeconds: 60 });
    expect(parseTvArgs(['soak', '--port', '9222', 'watch', '--minutes', '480', '--every', '30'])).toEqual({
      command: 'soak',
      words: ['watch'],
      lab: false,
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

  it('answers the usage for no command or an unknown one', () => {
    expect(parseTvArgs([])).toBe(USAGE);
    expect(parseTvArgs(['press'])).toBe(USAGE);
    expect(parseTvArgs(['--lab'])).toBe(USAGE);
    for (const command of TV_COMMANDS) expect(USAGE).toContain(`  ${command}`);
  });
});
