/**
 * The lab's spikes in run order (docs/architecture.md §5). Step 15a has the runtime spikes;
 * step 15b adds S6 and S9–S11, step 15c the player batteries S4, S5 and S8.
 */
import type { Spike } from '../types';
import { S0, S1 } from './s0-s1';
import { S2, S3 } from './s2-s3';
import { S7 } from './s7';

export const SPIKES: readonly Spike[] = [S0, S1, S2, S3, S7];
