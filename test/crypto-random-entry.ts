// An entry test/crypto-vectors-bundle.test.ts bundles through the TV pipeline (RELAY step 30b1):
// `randomBytes` alone from @lablo/crypto, which is marked side-effect free. tweetnacl must still
// be kept with the module body that hands it the platform's getRandomValues.
import { randomBytes } from '@lablo/crypto';

(self as unknown as { __random: (n: number) => Uint8Array }).__random = (n) => randomBytes(n);
