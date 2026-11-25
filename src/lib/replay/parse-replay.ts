import type { MatrixEvent } from '@/lib/matrix-api';

export interface ExportedJsonlRecord {
  event_id?: string;
  type?: string;
  sender?: string;
  timestamp?: number;
  origin_server_ts?: number;
  time?: string;
  msgtype?: string;
  body?: unknown;
  format?: string;
  url?: string;
  relates_to?: Record<string, unknown>;
  content?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * 将 debug-log 导出的扁平化 JSONL 记录反向还原为标准 MatrixEvent 对象。
 */
export function reconstructMatrixEvent(record: ExportedJsonlRecord): MatrixEvent | null {
  const eventId = record.event_id;
  const type = record.type;
  const sender = record.sender;
  const ts = record.origin_server_ts ?? record.timestamp ?? 0;

  if (!eventId || !type || !sender) {
    return null;
  }

  const content: Record<string, unknown> = record.content ? { ...record.content } : {};

  if (type === 'm.room.message') {
    if (record.msgtype) content.msgtype = record.msgtype;
    if (record.body !== undefined) content.body = record.body;
    if (record.format) content.format = record.format;
    if (record.url) content.url = record.url;
    if (record.relates_to) content['m.relates_to'] = record.relates_to;
  }

  return {
    event_id: eventId,
    type,
    sender,
    origin_server_ts: ts,
    content,
    unsigned: record.unsigned as Record<string, unknown> | undefined,
  } as MatrixEvent;
}

/**
 * 解析单个 JSONL 文件文本，提取出按原始时间戳排序的 MatrixEvent[]。
 */
export function parseReplayJsonl(jsonlText: string): MatrixEvent[] {
  if (!jsonlText) return [];
  const lines = jsonlText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const events: MatrixEvent[] = [];

  for (const line of lines) {
    try {
      const record = JSON.parse(line) as ExportedJsonlRecord;
      const ev = reconstructMatrixEvent(record);
      if (ev) {
        events.push(ev);
      }
    } catch {
      // 容错处理损坏的单行数据
    }
  }

  return events;
}
