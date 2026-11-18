'use client';

import { Button } from '@/components/ui/button';
import type { MatrixEvent } from '@/lib/matrix-api';
import { AttachmentCard } from '../attachment-card';

const ATTACHMENT_TYPES = new Set(['m.file', 'm.image', 'm.audio', 'm.video']);

interface RoomAttachmentsProps {
  events: MatrixEvent[];
  homeserver: string;
  isLoading: boolean;
  hasError: boolean;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  onLoadOlder: () => void;
}

export function RoomAttachments({ events, homeserver, isLoading, hasError, hasOlder, isLoadingOlder, onLoadOlder }: RoomAttachmentsProps) {
  const redacted = new Set(events.filter(event => event.type === 'm.room.redaction')
    .map(event => event.content.redacts ?? (event as MatrixEvent & { redacts?: string }).redacts));
  const seen = new Set<string>();
  const attachments = [...events].sort((a, b) => b.origin_server_ts - a.origin_server_ts).flatMap(event => {
    const content = event.content;
    const relation = content['m.relates_to'] as { rel_type?: string } | undefined;
    if (event.type !== 'm.room.message' || !ATTACHMENT_TYPES.has(content.msgtype ?? '') ||
        typeof content.url !== 'string' || !content.url || relation?.rel_type === 'm.replace' ||
        seen.has(event.event_id) || redacted.has(event.event_id) || event.unsigned?.redacted_because) return [];
    seen.add(event.event_id);
    const filename = typeof content.filename === 'string' ? content.filename : content.body;
    return [{
      id: event.event_id,
      payload: {
        url: content.url,
        filename: typeof filename === 'string' && filename.trim() ? filename : '附件',
        mimetype: content.info?.mimetype ?? 'application/octet-stream',
        size: content.info?.size,
      },
    }];
  });

  return (
    <section aria-label="会话附件" className="h-full overflow-y-auto custom-scrollbar p-3">
      <h2 className="mb-2 px-1 text-sm font-medium">会话附件</h2>
      {isLoading && <p role="status" className="px-1 py-3 text-sm text-muted-foreground">正在加载会话附件…</p>}
      {hasError && <p role="alert" className="px-1 py-3 text-sm text-muted-foreground">附件历史加载失败。</p>}
      {!isLoading && !hasError && attachments.length === 0 && (
        <p className="px-1 py-3 text-sm text-muted-foreground">{hasOlder ? '已加载的消息中暂无附件' : '当前会话暂无附件'}</p>
      )}
      {attachments.map(({ id, payload }) => <AttachmentCard key={id} payload={payload} homeserver={homeserver} compact />)}
      {hasOlder && (
        <Button variant="ghost" size="sm" disabled={isLoadingOlder} onClick={onLoadOlder} className="mt-2 w-full">
          {isLoadingOlder ? '加载中…' : '加载更早附件'}
        </Button>
      )}
    </section>
  );
}
