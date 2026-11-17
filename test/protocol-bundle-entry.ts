// The entry test/crypto-vectors-bundle.test.ts bundles through the TV pipeline for the protocol
// alone (RELAY step 29b2a): @lablo/protocol and zod with no other package's polyfills to lean
// on, so zod's polyfill allowlist (tools/build/src/bundle.ts DEPENDENCY_POLYFILLS) must carry it.
import { checkSamples } from '@lablo/protocol/check-samples';

(self as unknown as { __results: unknown }).__results = checkSamples();
