/**
 * `pnpm tv <command>`: drive a TV from the PC with nobody at it (RELAY step 39s6): the remote's
 * keys and text, the launch, the inspector, a soak monitor. Samsung first; with `--webos` (step 56)
 * the inspector commands go through `ares-inspect` on an LG TV. The commands and the setup are in
 * docs/runbooks/tv-setup.md 3.7; the logic, with its tests, is in src/.
 */
import { endProcess } from './src/exit';
import { main } from './src/main';

await main(process.argv.slice(2));
// Done: end now, even with the inspector's socket still open (ares-inspect never closes it, step 58d).
await endProcess(process.stdout, process.exitCode, (code) => process.exit(code));
