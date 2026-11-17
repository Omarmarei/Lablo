// An entry test/crypto-vectors-bundle.test.ts bundles through the TV pipeline (RELAY step 30b1):
// `blocklistHash` alone from @lablo/crypto, which is marked side-effect free, so none of tweetnacl
// is kept (the query worker checks the blocklist, step 30b2).
import { blocklistHash } from '@lablo/crypto';

(self as unknown as { __hash: (salt: string, host: string) => string }).__hash = (salt, host) => blocklistHash(salt, host);
