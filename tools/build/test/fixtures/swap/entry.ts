// A store swap (RELAY step 35b): `./feature` has a stand-in the store build takes; `./lib/feature`
// has the same name and none.
import { which } from './feature';
import { which as other } from './lib/feature';

(globalThis as unknown as { fixture: string }).fixture = `${which()} + ${other()}`;
