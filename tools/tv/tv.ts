/**
 * `pnpm tv <command>`: drive a TV from the PC with nobody at it (RELAY step 39s6): the remote's
 * keys and text, the launch, the inspector, a soak monitor. Samsung first; the inspector commands
 * also take webOS's port (`--port`). The commands and the setup are in
 * docs/runbooks/tv-setup.md 3.7; the logic, with its tests, is in src/.
 */
import { main } from './src/main';

await main(process.argv.slice(2));
