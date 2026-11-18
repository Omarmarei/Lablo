/**
 * The phone's M3U file as the ingest worker reads it (RELAY step 31d2a): plain frames pulled one at
 * a time from the pair worker, which fetches and opens them (file-frames.ts), over a message port
 * whose other end the app gave the pair worker (`DataEngine`'s `PairSession.file`). The ingest
 * reads it as an M3U link's body (`runIngest`'s `m3u-file` source).
 *
 * - A frame the pair worker can't open fails the read with `IngestError('file')`; any other
 *   failure on its side (the connection, a pair worker that closed) with `NetworkError`.
 * - `cancel` tells the pair worker, which lets the download go.
 * - A load is cancelled before its pair worker ends (the pairing screen's `close`): a read waiting
 *   on a worker that is gone gets no answer until then.
 */
import type { ByteResponse } from './bytes';
import { NetworkError } from './bytes';
import type { FileFrameHandlers } from './file-frames';
import { IngestError } from './ingest-errors';
import type { RpcPort } from './rpc';
import { CancelError, RpcClient } from './rpc';

/** The file's port (transferred with the ingest's `run`) and its plain length. */
export interface FileFeed {
  readonly port: RpcPort;
  /** The plain file's length: the progress bar's total. */
  readonly size: number;
}

const ignore = (): void => undefined;

/** The file as a download: status 200, `content-length` its plain length, the frames as chunks. */
export function feedResponse(feed: FileFeed): ByteResponse {
  const client = new RpcClient<FileFrameHandlers>(feed.port);
  let done = false;
  let cancelled = false;
  const length = String(feed.size);
  return {
    status: 200,
    header: (name) => (name.toLowerCase() === 'content-length' ? length : null),
    async read() {
      if (done) return null;
      let chunk: Uint8Array | null;
      try {
        chunk = await client.call('read');
      } catch (error) {
        done = true;
        client.close();
        if (cancelled) throw new CancelError();
        throw (error as { code?: unknown }).code === 'file' ? new IngestError('file') : new NetworkError('The file broke off');
      }
      if (chunk === null) {
        done = true;
        client.close();
      }
      return chunk;
    },
    cancel() {
      if (done) return;
      done = true;
      cancelled = true;
      client.call('cancel').catch(ignore);
      client.close();
    },
  };
}
