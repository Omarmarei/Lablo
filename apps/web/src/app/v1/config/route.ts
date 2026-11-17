import signedFile from '../../../../../../config/config.signed.json';
import { configAnswer, loadSignedConfig } from '../../../server/config';

const signed = loadSignedConfig(signedFile);

// The answer carries the caller's country: built for each request, never at build time.
export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  return configAnswer(signed, request.headers);
}
