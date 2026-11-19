// The entry test/scrub-bundle.test.ts bundles through the TV pipeline (RELAY step 33a): the
// telemetry scrubber alone, as the TV's workers will import it (`@lablo/protocol/scrub`, no zod).
import { scrubText } from '@lablo/protocol/scrub';

(self as unknown as { __scrub: typeof scrubText }).__scrub = scrubText;
