/**
 * The end of a `pnpm tv` command (RELAY step 58d). Through `ares-inspect` the inspector's
 * WebSocket never finishes its close handshake (the socket stays open, `readyState` 2), so a
 * command that had done its work never ended: Node waits for every open socket. Each command now
 * ends the process when it is done, once what it printed is written out.
 */

/** The part of `process.stdout` used: a write with a callback once it is flushed. */
export interface Flushable {
  write(chunk: string, done: () => void): boolean;
}

/** The exit code for `process.exitCode` (unset: 0; a string, as Node allows, read as a number). */
export function exitCode(code: number | string | null | undefined): number {
  if (code === undefined || code === null || code === '') return 0;
  const value = Number(code);
  return Number.isInteger(value) ? value : 1;
}

/** Ends the process with `code` once `out` has written what came before. */
export function endProcess(out: Flushable, code: number | string | null | undefined, exit: (code: number) => void): Promise<void> {
  return new Promise((resolve) => {
    out.write('', () => {
      exit(exitCode(code));
      resolve();
    });
  });
}
