import type { ConfigResult } from '@lablo/data';

/**
 * The hello screen's config rows (RELAY step 30c1): one config run with the build's request (and
 * `?api=`), then `blocked` for each `?check=<url>`. The old-engine harness reads them, so the
 * config worker and the query worker's blocklist run on Chromium 53, 56 and 68. Pure, so the
 * texts are unit-tested; DataPanel shows them.
 */

/** The config row: its text and the attributes the harness reads. */
export interface ConfigRowState {
  /** `ok: fresh, issued …`, `ok: cached (<failure>), issued …`, or `none: <failure>`. */
  readonly text: string;
  /** `fresh`, `cached` or `none`. */
  readonly status: string;
  /** The `ConfigFailure`, or ''. */
  readonly failure: string;
  /** `<id>:<mode>` of the kill rule in force, or ''. */
  readonly kill: string;
  /** The notices' ids, comma-separated. */
  readonly notices: string;
}

function joinIds(ids: readonly string[], separator: string): string {
  let out = '';
  for (let i = 0; i < ids.length; i++) out += (i === 0 ? '' : separator) + ids[i];
  return out;
}

export function describeConfig(result: ConfigResult): ConfigRowState {
  const { kill, notices, updateRequired } = result.policy;
  const ids: string[] = [];
  for (const notice of notices) ids.push(notice.id);
  let text: string;
  // No doc (`none`): the defaults.
  if (result.issuedAt === null) {
    text = 'none: ' + (result.failure ?? 'no config') + ' (nothing killed, nothing blocked)';
  } else {
    const parts = [
      result.status === 'fresh' ? 'ok: fresh' : 'ok: cached (' + (result.failure ?? 'not fetched') + ')',
      'issued ' + new Date(result.issuedAt).toISOString(),
      kill === null ? 'nothing killed' : 'kill ' + kill.id + ' (' + kill.mode + ')',
      ids.length === 0 ? 'no notices' : 'notices ' + joinIds(ids, ' '),
    ];
    if (updateRequired) parts.push('update required');
    if (!result.stored) parts.push('not stored');
    text = joinIds(parts, ', ');
  }
  return {
    text,
    status: result.status,
    failure: result.failure ?? '',
    kill: kill === null ? '' : kill.id + ':' + kill.mode,
    notices: joinIds(ids, ','),
  };
}

/** The blocklist row: `ok: blocked, allowed` and `true,false`. */
export interface BlockedRowState {
  readonly text: string;
  readonly blocked: string;
}

export function describeBlocked(answers: readonly boolean[]): BlockedRowState {
  const words: string[] = [];
  const flags: string[] = [];
  for (const answer of answers) {
    words.push(answer ? 'blocked' : 'allowed');
    flags.push(answer ? 'true' : 'false');
  }
  return { text: 'ok: ' + joinIds(words, ', '), blocked: joinIds(flags, ',') };
}
