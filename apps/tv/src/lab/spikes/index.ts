/**
 * The lab's spikes in run order (docs/architecture.md §5). Step 15a has the runtime spikes,
 * step 15b S6 (last: it takes minutes on a TV, so the quick answers arrive first), step 15b2
 * S9 and S11, step 15b3 S10, step 15c the `<video>` battery S5 (before S6: a battery takes about
 * a minute, S6 minutes) and step 15c2 the AVPlay batteries S4 and S8 (around S5: the three
 * players' rows together).
 */
import type { Spike } from '../types';
import { S0, S1 } from './s0-s1';
import { S2, S3 } from './s2-s3';
import { S4 } from './s4';
import { S5 } from './s5';
import { S6 } from './s6';
import { S7 } from './s7';
import { S8 } from './s8';
import { S9 } from './s9';
import { S10 } from './s10';
import { S11 } from './s11';

export const SPIKES: readonly Spike[] = [S0, S1, S2, S3, S7, S9, S10, S11, S4, S5, S8, S6];
