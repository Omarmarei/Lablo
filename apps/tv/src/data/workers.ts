/**
 * The data workers as the app starts them. `pnpm dev` serves them as module workers; the TV
 * build bundles each one as its own Chromium 53 IIFE and inlines it as a Blob URL
 * (tools/build/src/bundle.ts), so no worker file exists on disk.
 */
import BackupWorker from '@lablo/data/backup.worker?worker';
import ConfigWorker from '@lablo/data/config.worker?worker';
import EpgWorker from '@lablo/data/epg.worker?worker';
import IngestWorker from '@lablo/data/ingest.worker?worker';
import PairWorker from '@lablo/data/pair.worker?worker';
import QueryWorker from '@lablo/data/query.worker?worker';
import TelemetryWorker from '@lablo/data/telemetry.worker?worker';
import type { DataEngineOptions } from './engine';
import { DataEngine } from './engine';

/**
 * The app's data engine with its workers. `onWorkerError` is required here (step 33c): an app that
 * left it out would lose its workers' crash reports without a sign.
 */
export function createAppDataEngine(
  options: Omit<DataEngineOptions, 'startQueryWorker' | 'startIngestWorker' | 'startEpgWorker' | 'startConfigWorker' | 'startPairWorker' | 'startBackupWorker' | 'startTelemetryWorker'> & Pick<Required<DataEngineOptions>, 'onWorkerError'>,
): DataEngine {
  return new DataEngine({
    ...options,
    startQueryWorker: () => new QueryWorker(),
    startIngestWorker: () => new IngestWorker(),
    startEpgWorker: () => new EpgWorker(),
    startConfigWorker: () => new ConfigWorker(),
    startPairWorker: () => new PairWorker(),
    startBackupWorker: () => new BackupWorker(),
    startTelemetryWorker: () => new TelemetryWorker(),
  });
}
