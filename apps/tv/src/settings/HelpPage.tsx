import type { VNode } from 'preact';
import type { FocusBinding, ItemBinding } from '@lablo/ui';
import { Button, pseudoLocalize, useZone } from '@lablo/ui';
import type { AppI18n } from '../i18n';
import type { HelpPage } from './help-page';
import type { HelpBlock, HelpNames, HelpTopic, HelpTopicText } from './help-text';
import { HELP_TOPICS, SUPPORT_EMAIL, helpTopic } from './help-text';

/**
 * Settings › "Help" as drawn (RELAY step 40c): the topics as rows (the name, the line under it),
 * and a topic's page: its title, its blocks in order, "Close". The words are `help-text.ts`'s, in
 * the app's language (en-XA through `pseudoLocalize`, as the catalogs are); the names of the app's
 * own rows and buttons they quote come from the catalogs. Error codes, the address and the support
 * code are left to right in both languages and never translated (`translate={false}`).
 */

/** The catalog names the help quotes. */
export function helpNames(i18n: AppI18n): HelpNames {
  const { t } = i18n;
  return { sources: t('settings.sources'), addPhone: t('sources.addPhone'), connection: t('settings.connection'), report: t('settings.report') };
}

/** A topic's words in the app's language. */
export function topicText(i18n: AppI18n, topic: HelpTopic): HelpTopicText {
  const text = helpTopic(i18n.locale.language, helpNames(i18n), topic);
  if (!i18n.locale.pseudo) return text;
  const blocks: HelpBlock[] = [];
  for (let i = 0; i < text.blocks.length; i++) {
    const b = text.blocks[i]!;
    if (b.kind === 'p') blocks.push({ kind: 'p', text: pseudoLocalize(b.text) });
    else if (b.kind === 'item') blocks.push({ kind: 'item', term: b.ltr ? b.term : pseudoLocalize(b.term), text: pseudoLocalize(b.text), ltr: b.ltr });
    else if (b.kind === 'mail') blocks.push({ kind: 'mail', text: pseudoLocalize(b.text) });
    else blocks.push({ kind: 'code', text: pseudoLocalize(b.text), none: pseudoLocalize(b.none) });
  }
  return { title: pseudoLocalize(text.title), hint: pseudoLocalize(text.hint), blocks };
}

function rowClass(item: ItemBinding): string {
  return item.state === 'focused' ? 'settings__row is-focused' : item.state === 'memory' ? 'settings__row is-memory' : 'settings__row';
}

/** One block, a plain function (not a component: the view's tests read its markup whole). */
function blockView(block: HelpBlock, n: number, code: string | null): VNode {
  if (block.kind === 'item') {
    return (
      <div key={n} class="help__item" data-testid={`help-item-${n}`}>
        {block.ltr ? (
          <span class="help__term help__term--code" dir="ltr" translate={false}>
            {block.term}
          </span>
        ) : (
          <span class="help__term">{block.term}</span>
        )}
        <span class="help__meaning">{block.text}</span>
      </div>
    );
  }
  if (block.kind === 'mail') {
    return (
      <p key={n} class="help__p help__mail" data-testid="help-mail">
        <span>{block.text} </span>
        <span class="help__address" dir="ltr" translate={false}>
          {SUPPORT_EMAIL}
        </span>
      </p>
    );
  }
  if (block.kind === 'code') {
    return code === null ? (
      <p key={n} class="help__p help__none" data-testid="help-code">
        {block.none}
      </p>
    ) : (
      <p key={n} class="help__p help__mail" data-testid="help-code">
        <span>{block.text} </span>
        <span class="help__address" dir="ltr" translate={false} data-testid="help-code-value">
          {code}
        </span>
      </p>
    );
  }
  return (
    <p key={n} class="help__p">
      {block.text}
    </p>
  );
}

/** The topics' list as drawn, hook-free. */
export function HelpListView({ i18n, item }: { i18n: AppI18n; item: (index: number) => ItemBinding }) {
  const { t } = i18n;
  return (
    <div class="settings__page" data-testid="help">
      <header class="settings__header">
        <h1 class="settings__title">{t('settings.help')}</h1>
      </header>
      <div class="settings__items" role="menu" data-count={HELP_TOPICS.length}>
        {HELP_TOPICS.map((topic, n) => {
          const binding = item(n);
          const text = topicText(i18n, topic);
          return (
            <div key={topic} class={rowClass(binding)} role="menuitem" data-testid={`help-topic-${topic}`} data-state={binding.state} onMouseMove={binding.onHover} onClick={binding.onPress}>
              <div class="settings__top">
                <span class="settings__name">{text.title}</span>
              </div>
              <span class="settings__hint">{text.hint}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A topic's page as drawn, hook-free. */
export function HelpTopicView({ i18n, topic, code, button }: { i18n: AppI18n; topic: HelpTopic; code: string | null; button: (index: number) => ItemBinding }) {
  const { t } = i18n;
  const text = topicText(i18n, topic);
  return (
    <div class="settings__page help" data-testid="help-page" data-topic={topic}>
      <header class="settings__header">
        <h1 class="settings__title" data-testid="help-title">
          {text.title}
        </h1>
      </header>
      <div class="help__body">{text.blocks.map((block, n) => blockView(block, n, code))}</div>
      <div class="help__buttons">
        <Button label={t('action.close')} variant="primary" {...button(0)} testId="help-close" />
      </div>
    </div>
  );
}

export function HelpListPage({ i18n, binding }: { i18n: AppI18n; binding: FocusBinding }) {
  const zone = useZone(binding, binding.nav.top, 'topics');
  return <HelpListView i18n={i18n} item={(i) => zone.item(i)} />;
}

export function HelpTopicPage({ i18n, binding, page }: { i18n: AppI18n; binding: FocusBinding; page: HelpPage }) {
  const buttons = useZone(binding, binding.nav.top, 'actions');
  return <HelpTopicView i18n={i18n} topic={page.topic.value} code={page.supportCode()} button={(i) => buttons.item(i)} />;
}
