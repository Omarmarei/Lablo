import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { CatalogItem, ContentKey } from '@lablo/core';
import type { ChannelEdit, KeyItemsRequest } from '@lablo/data/client';
import { channelEditsOf, cleanNamesOn } from '@lablo/data/client';
import type { Navigator, Screen, ZoneSpec } from '@lablo/ui';
import { KEY_BATCH } from '../live/live-state';
import { storedSources } from '../onboarding/engine-loader';
import type { ChannelEditEngine, ChannelEditor, EditTarget } from './channel-edit';
import { GROUPS_VISIBLE } from './groups-state';

/**
 * Settings › "Channels" (RELAY step 36c, architecture.md §1.4 item 10 "Built in step 36c"): the
 * switch and the channels the user changed, pushed on the live navigator from the settings screen.
 *
 *   rows  ("Clean channel names" first, its value beside it: OK switches it; then every changed
 *         channel in the profile's order, OK opening "Edit channel" over the page)
 *
 * - **The rows** are read here: the profile (the switch, the changed channels), then each changed
 *   channel's item by key (`itemsByKey`, `KEY_BATCH` a call, the stored sources), so a row shows
 *   the name and number the worker shows; a channel the catalog doesn't have now shows the user's
 *   name, else its stored normalized one, and "Not in your sources now".
 * - **After an edit** (the switch, or one the menu made) the live screen reads the channels again
 *   (`changed`) and the rows are read again, the focus on the row the edit was about (a channel
 *   whose last change went: the row that takes its place).
 * - This is where a hidden channel comes back (with search, which still finds it).
 */

export const CHANNELS_SCREEN = 'channels';
/** The switch's row: the first. */
export const CLEAN_ROW = 0;

export type ChannelsStatus = 'loading' | 'ready' | 'failed';

/** What the page needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface EditedEngine extends ChannelEditEngine {
  itemsByKey(req: KeyItemsRequest): Promise<CatalogItem[]>;
}

export interface EditedOptions {
  readonly nav: Navigator;
  readonly engine: EditedEngine;
  /** "Edit channel", opened over the page. */
  readonly editor: ChannelEditor;
  /** An edit went through: the live screen reads the channels again (`Live.channelsChanged`). */
  readonly changed?: () => unknown;
}

export interface EditedChannels {
  /** The page while it is on the stack. */
  readonly screen: ReadonlySignal<Screen | null>;
  readonly status: ReadonlySignal<ChannelsStatus>;
  /** "Clean channel names" as stored (`null`: not read yet). */
  readonly clean: ReadonlySignal<boolean | null>;
  /** The last switch didn't take. */
  readonly failed: ReadonlySignal<boolean>;
  /** The changed channels, in the profile's order. */
  readonly rows: ReadonlySignal<readonly EditTarget[]>;
  /** Reads and edits in flight: 0 means settled (e2e). */
  readonly pending: ReadonlySignal<number>;
  /** Opens the page and reads the rows. */
  open(): void;
  dispose(): void;
}

/** The changed channels as rows: each with the item found for it, in the profile's order. */
export function editedRows(edits: readonly ChannelEdit[], found: readonly CatalogItem[]): EditTarget[] {
  const byKey = new Map<ContentKey, CatalogItem>();
  for (let i = 0; i < found.length; i += 1) byKey.set(found[i]!.key, found[i]!);
  return edits.map((edit) => {
    const item = byKey.get(edit.key) ?? null;
    return { key: edit.key, item, edit, name: item !== null ? item.name : edit.name !== undefined ? edit.name : edit.normName };
  });
}

/** The read: the switch, the changed channels and their items. */
interface Read {
  readonly clean: boolean;
  readonly rows: EditTarget[];
}

export function createEditedChannels(options: EditedOptions): EditedChannels {
  const { nav, engine, editor } = options;
  const screen = signal<Screen | null>(null);
  const status = signal<ChannelsStatus>('loading');
  const clean = signal<boolean | null>(null);
  const failed = signal(false);
  const rows = signal<readonly EditTarget[]>([]);
  const pending = signal(0);
  let disposed = false;
  /** Bumps on each read: an older read's answer is dropped. */
  let readSeq = 0;
  /** The channel the focus goes to when the next read lands. */
  let follow: ContentKey | null = null;
  /** A switch on its way: OK waits. */
  let switching = false;

  /** Runs `request`, counting it in `pending` until it settles either way. */
  function track<T>(request: () => Promise<T>): Promise<T> {
    pending.value += 1;
    let running: Promise<T>;
    try {
      running = request();
    } catch (error) {
      running = Promise.reject(error);
    }
    const settle = (): void => {
      pending.value -= 1;
    };
    running.then(settle, settle);
    return running;
  }

  const zone = (count: number): ZoneSpec => ({ kind: 'list', id: 'rows', axis: 'vertical', count, visible: GROUPS_VISIBLE });

  /** Reads the switch and the rows again; settles once they are in, either way. */
  const read = (): Promise<void> => {
    readSeq += 1;
    const seq = readSeq;
    const wanted = follow;
    follow = null;
    return track(async (): Promise<Read> => {
      const profile = await engine.profile();
      const doc = profile === null ? null : profile.doc;
      const edits = channelEditsOf(doc);
      const sources = storedSources(profile).map((s) => s.id);
      const asks: Promise<CatalogItem[]>[] = [];
      for (let i = 0; i < edits.length; i += KEY_BATCH) {
        const keys = edits.slice(i, i + KEY_BATCH).map((e) => e.key);
        asks.push(engine.itemsByKey({ keys, kind: 'live', sources, limit: keys.length }));
      }
      const found = await Promise.all(asks);
      let items: CatalogItem[] = [];
      for (let b = 0; b < found.length; b += 1) items = items.concat(found[b]!);
      return { clean: cleanNamesOn(doc), rows: editedRows(edits, items) };
    }).then(
      (got) => {
        if (disposed || seq !== readSeq) return;
        clean.value = got.clean;
        rows.value = got.rows;
        status.value = 'ready';
        const shown = screen.value;
        if (shown === null) return;
        shown.update(zone(1 + got.rows.length));
        for (let i = 0; i < got.rows.length; i += 1) if (got.rows[i]!.key === wanted) shown.focus('rows', 1 + i);
      },
      (error: unknown) => {
        if (disposed || seq !== readSeq) return;
        console.warn('The changed channels could not be read', error);
        if (status.value === 'loading') status.value = 'failed';
      },
    );
  };

  /** "Clean channel names": the other value, then the live screen and the rows read again. */
  const toggle = (): void => {
    const on = clean.value;
    if (on === null || switching) return;
    switching = true;
    failed.value = false;
    track(() => engine.editProfile({ kind: 'cleanNames', on: !on }))
      .then(
        (ok) => {
          if (!ok) failed.value = true;
          else options.changed?.();
          return ok;
        },
        (error: unknown) => {
          failed.value = true;
          console.warn('"Clean channel names" was not changed', error);
          return false;
        },
      )
      .then((ok) => {
        switching = false;
        return ok && !disposed ? read() : undefined;
      });
  };

  /** A changed channel's menu; after an edit the rows read again, the focus on it. */
  const openRow = (row: EditTarget): void => {
    editor.open(row, () => {
      if (disposed) return;
      follow = row.key;
      void read();
    });
  };

  return {
    screen,
    status,
    clean,
    failed,
    rows,
    pending,
    open(): void {
      if (disposed) return;
      failed.value = false;
      screen.value = nav.push({
        id: CHANNELS_SCREEN,
        zones: [zone(1 + rows.value.length)],
        onSelect: (focus) => {
          if (pending.value > 0) return;
          if (focus.index === CLEAN_ROW) toggle();
          else {
            const row = rows.value[focus.index - 1];
            if (row !== undefined) openRow(row);
          }
        },
        onIntent: (intent) => {
          if (intent !== 'BACK') return false;
          screen.value = null;
          nav.pop();
          return true;
        },
      });
      void read();
    },
    dispose(): void {
      disposed = true;
    },
  };
}
