import type { VNode } from 'preact';
import { describe, expect, it } from 'vitest';
import { appI18n } from '../i18n';
import { SubtitleOverlay } from './SubtitleOverlay';
import { timingText } from './TrackMenuPanel';

/** The subtitle overlay and the timing's words (RELAY step 20b2b). The overlay is hook-free: called as a function. */

type Props = Record<string, unknown> & { children?: unknown };

function kids(node: VNode): VNode[] {
  const children = (node.props as Props).children;
  return (Array.isArray(children) ? children : [children]).filter((c): c is VNode => c !== null && typeof c === 'object');
}

describe('SubtitleOverlay', () => {
  it('draws each cue as a block in its own direction, untranslated, in the chosen size', () => {
    const arabic = String.fromCharCode(0x645, 0x631, 0x62d, 0x628, 0x627);
    const root = SubtitleOverlay({ cues: ['Hello\nthere', arabic], size: 'l' });
    expect(root.props).toMatchObject({ class: 'subtitles subtitles--l', 'data-size': 'l', 'data-count': 2, 'data-testid': 'subtitles' });
    const cues = kids(root);
    expect(cues.map((c) => (c.props as Props).class)).toEqual(['subtitles__cue', 'subtitles__cue']);
    const texts = cues.map((c) => kids(c)[0]!);
    expect(texts.map((t) => t.props)).toEqual([
      { class: 'subtitles__text', dir: 'auto', translate: false, 'data-testid': 'subtitle-cue', children: 'Hello\nthere' },
      { class: 'subtitles__text', dir: 'auto', translate: false, 'data-testid': 'subtitle-cue', children: arabic },
    ]);
    // Keyed by place and text: a cue that stays keeps its element.
    expect(cues.map((c) => c.key)).toEqual(['0 Hello\nthere', `1 ${arabic}`]);
  });

  it('draws an empty block when nothing shows', () => {
    const root = SubtitleOverlay({ cues: [], size: 'm' });
    expect(root.props).toMatchObject({ class: 'subtitles subtitles--m', 'data-count': 0 });
    expect(kids(root)).toEqual([]);
  });
});

describe('timingText', () => {
  it("says a file's timing in the UI's words and digits", () => {
    const en = appI18n('en-US');
    expect([timingText(en, 0), timingText(en, 500), timingText(en, -1250), timingText(en, 30_000)]).toEqual(['No delay', '0.5 s later', '1.25 s earlier', '30 s later']);
    const ar = appI18n('ar-SA');
    expect(timingText(ar, 0)).toBe('بلا تأخير');
    expect(timingText(ar, 250)).toMatch(/^متأخرة .+ ث$/);
    expect(timingText(ar, -250)).toMatch(/^مبكرة .+ ث$/);
  });
});
