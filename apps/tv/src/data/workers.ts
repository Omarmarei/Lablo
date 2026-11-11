/**
 * The data workers as the app starts them. `pnpm dev` serves them as module workers; the TV
 * build bundles each one as its own Chromium 53 IIFE and inlines it as a Blob URL
 * (tools/build/src/bundle.ts), so no worker file exists on disk.
 */
import EpgWorker from '@lablo/data/epg.worker?worker';
import IngestWorker from '@lablo/data/ingest.worker?worker';
import QueryWorker from '@lablo/data/query.worker?worker';
import type { DataEngineOptions } from './engine';
import { DataEngine } from './engine';

export function createAppDataEngine(options: Omit<DataEngineOptions, 'startQueryWorker' | 'startIngestWorker' | 'startEpgWorker'> = {}): DataEngine {
  return new DataEngine({
    ...options,
    startQueryWorker: () => new QueryWorker(),
    startIngestWorker: () => new IngestWorker(),
    startEpgWorker: () => new EpgWorker(),
  });
}
