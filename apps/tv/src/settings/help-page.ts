import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { Navigator } from '@lablo/ui';
import type { HelpTopic } from './help-text';
import { HELP_TOPICS } from './help-text';

/**
 * Settings › "Help" (RELAY step 40c): a list of topics, each with a line under its name as the
 * settings rows have (all in view: `HELP_TOPICS.length` stays within `SETTINGS_VISIBLE`, a unit test pins it); OK on one opens its page (the words: `help-text.ts`, which loads with
 * settings.js, never the main catalogs) with one "Close" button. Back closes a page, then the list.
 *
 * The support topic shows the code "Send a report to support" gave, when it gave one since Settings
 * was opened (`supportCode`: the report row's state, read where the page is drawn).
 *
 * Main-safe as the settings are: no `trim`, `.sort(`, regex or object spread.
 */

export const HELP_SCREEN = 'help';
export const HELP_TOPIC_SCREEN = 'help-topic';

export interface HelpOptions {
  readonly nav: Navigator;
  /** The support code the report row shows now, else `null` (read while drawing). */
  readonly supportCode: () => string | null;
}

export interface HelpPage {
  /** The topic on the open topic page. */
  readonly topic: ReadonlySignal<HelpTopic>;
  readonly supportCode: () => string | null;
  /** Opens the list of topics. */
  open(): void;
  /** Opens a topic's page. */
  openTopic(topic: HelpTopic): void;
}

export function createHelpPage(options: HelpOptions): HelpPage {
  const { nav } = options;
  const topic = signal<HelpTopic>(HELP_TOPICS[0]!);
  const openTopic = (chosen: HelpTopic): void => {
    topic.value = chosen;
    nav.push({
      id: HELP_TOPIC_SCREEN,
      zones: [{ kind: 'list', id: 'actions', axis: 'horizontal', count: 1 }],
      onSelect: () => nav.pop(),
    });
  };
  return {
    topic,
    supportCode: options.supportCode,
    open(): void {
      nav.push({
        id: HELP_SCREEN,
        zones: [{ kind: 'list', id: 'topics', axis: 'vertical', count: HELP_TOPICS.length }],
        onSelect: (focus) => {
          const chosen = HELP_TOPICS[focus.index];
          if (chosen !== undefined) openTopic(chosen);
        },
      });
    },
    openTopic,
  };
}
