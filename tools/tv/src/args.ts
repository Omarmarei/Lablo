/** `pnpm tv` arguments: the command, its words, and the flags (RELAY step 39s6). */

export const TV_COMMANDS = ['setup', 'keys', 'launch', 'inspect', 'reconnect', 'state', 'eval', 'screen', 'marks', 'soak'] as const;
export type TvCommand = (typeof TV_COMMANDS)[number];

export interface TvArgs {
  readonly command: TvCommand;
  /** The words after the command, flags removed. */
  readonly words: readonly string[];
  /** The Lablo Lab instead of the app (launch, inspect, state). */
  readonly lab: boolean;
  /** An inspector port other than the saved one (webOS: `ares-inspect`'s). */
  readonly port?: number;
  /** soak watch: how long, and how often to drain. */
  readonly minutes: number;
  readonly everySeconds: number;
}

export const USAGE = [
  'Usage: pnpm tv <command> (docs/runbooks/tv-setup.md 3.7)',
  '  setup <host> [serial]        write .tv.local.json (gitignored)',
  '  keys <KEY_X|ms|TEXT:abc|END>...   the remote: keys, pauses, text, keyboard done',
  '  launch [--lab]               sdb was_execute, timed',
  '  inspect [--lab]              relaunch with the inspector, forward its port',
  '  reconnect                    sdb connect and forward the saved port again',
  '  state [--lab]                running and visible, from the TV',
  '  eval <expression|@file> [--port N]',
  '  screen [--port N]            the focus path and the page text',
  '  marks [--port N]             the start marks (ms from navigation start)',
  '  soak start|watch|report <file> [--minutes 120] [--every 60] [--port N]',
].join('\n');

/** The parsed arguments, or what is wrong with them. */
export function parseTvArgs(argv: readonly string[]): TvArgs | string {
  const words: string[] = [];
  let lab = false;
  let port: number | undefined;
  let minutes = 120;
  let everySeconds = 60;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--lab') {
      lab = true;
      continue;
    }
    if (arg === '--port' || arg === '--minutes' || arg === '--every') {
      const value = Number(argv[i + 1]);
      i += 1;
      if (!Number.isInteger(value) || value < 1) return `${arg} needs a whole number above 0`;
      if (arg === '--port') {
        if (value > 65_535) return '--port needs a port number';
        port = value;
      } else if (arg === '--minutes') minutes = value;
      else everySeconds = value;
      continue;
    }
    words.push(arg);
  }
  const [command, ...rest] = words;
  if (!TV_COMMANDS.includes(command as TvCommand)) return USAGE;
  return { command: command as TvCommand, words: rest, lab, ...(port === undefined ? {} : { port }), minutes, everySeconds };
}
