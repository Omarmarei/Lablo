import type { Container } from '@lablo/player';
import type { AppI18n, MessageKey } from '../i18n';
import type { StreamInfo } from './stream-info';
import { audioText, bitrateUnits, containerName, engineName, pictureSize } from './stream-info';

/** One row: its label, its value, and whether the value is a technical name (shown as it is, left to right). */
interface Row {
  readonly id: string;
  readonly label: MessageKey;
  readonly value: string;
  readonly technical: boolean;
}

/** The rows the panel has figures for, in order; the format comes from the status (known while the stream opens). */
export function streamInfoRows(info: StreamInfo | null, container: Container | null, i18n: AppI18n): Row[] {
  const { t } = i18n;
  const rows: Row[] = [];
  const add = (id: string, label: MessageKey, value: string, technical: boolean): void => {
    if (value !== '') rows.push({ id, label, value, technical });
  };
  if (info !== null) {
    add('resolution', 'player.info.resolution', pictureSize(info), true);
    if (info.fps !== null) add('fps', 'player.info.frameRate', t('player.info.fps', { fps: Math.round(info.fps) }), false);
    if (info.bitrate !== null) {
      const rate = bitrateUnits(info.bitrate);
      add('bitrate', 'player.info.bitrate', t(rate.unit === 'mbps' ? 'player.info.mbps' : 'player.info.kbps', { value: rate.value }), false);
    }
    add('video', 'player.info.video', info.videoCodec, true);
    add('audio', 'player.info.audio', audioText(info), true);
  }
  add('format', 'player.info.format', containerName(container), true);
  if (info !== null) {
    add('engine', 'player.info.engine', engineName(info.engine), true);
    if (info.droppedFrames !== null) add('dropped', 'player.info.dropped', i18n.number(info.droppedFrames), false);
  }
  return rows;
}

/**
 * The stream info (RELAY step 20c2a): the figures of the stream on show, at the top-start corner
 * of the safe area, under the "Reconnecting…" badge. Hook-free: the player reads its signals.
 */
export function StreamInfoPanel({ info, container, i18n }: { info: StreamInfo | null; container: Container | null; i18n: AppI18n }) {
  const { t } = i18n;
  const rows = streamInfoRows(info, container, i18n);
  return (
    <section class="stream-info" data-testid="player-stream-info" data-picture={String(info !== null)}>
      <h2 class="stream-info__title">{t('player.streamInfo')}</h2>
      {info === null && <p class="stream-info__note">{t('player.info.waiting')}</p>}
      {rows.map((row) => (
        <div class="stream-info__row" key={row.id} data-testid={`stream-info-${row.id}`}>
          <span class="stream-info__label">{t(row.label)}</span>
          {row.technical ? (
            <span class="stream-info__value" dir="ltr" translate={false}>
              {row.value}
            </span>
          ) : (
            <span class="stream-info__value">{row.value}</span>
          )}
        </div>
      ))}
    </section>
  );
}
