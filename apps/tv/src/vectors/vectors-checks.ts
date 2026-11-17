/**
 * Every check the vectors page runs, in the page and in the worker alike: @lablo/crypto's shared
 * vectors (step 29b1), then @lablo/protocol's samples on zod's compiled and interpreted paths
 * (step 29b2a), then @lablo/core's QR encoder on its golden cases (step 31c1). One list of
 * results, crypto's first; the harness and the e2e test expect Node's names in this order.
 */
import type { CryptoVectors, VectorResult } from '@lablo/crypto/check-vectors';
import { checkVectors } from '@lablo/crypto/check-vectors';
import { checkQr } from '@lablo/core/check-qr';
import { checkSamples } from '@lablo/protocol/check-samples';

export function runChecks(vectors: CryptoVectors): Promise<readonly VectorResult[]> {
  return checkVectors(vectors).then((crypto): readonly VectorResult[] => {
    const results: VectorResult[] = crypto.slice();
    const samples = checkSamples();
    for (let i = 0; i < samples.length; i++) results.push(samples[i]!);
    const qr = checkQr();
    for (let i = 0; i < qr.length; i++) results.push(qr[i]!);
    return results;
  });
}
