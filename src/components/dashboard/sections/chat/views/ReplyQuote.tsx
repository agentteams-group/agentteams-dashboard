'use client';

import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { formatMatrixEvent, type DisplayMessage } from '@/hooks/use-matrix';
import { matrixApi } from '@/lib/matrix-api';
import { useMatrixStore } from '@/lib/matrix-store';

export function messageQuoteExcerpt(message: DisplayMessage): string {
  return message.content.replace(/\s+/g, ' ').trim().slice(0, 180) || (message.mediaUrl ? '附件' : '消息');
}

export function ComposerReply({ target, memberMap, onCancel }: {
  target: DisplayMessage;
  memberMap?: Record<string, string>;
  onCancel: () => void;
}) {
  return <div className="flex items-center gap-2 border-b border-border px-3 py-2">
    <div className="min-w-0 flex-1 border-l-2 border-emerald-500/70 pl-2 text-xs">
      <p className="truncate font-medium">回复给：{memberMap?.[target.sender] || target.senderShort}</p>
      <p className="truncate text-muted-foreground">{messageQuoteExcerpt(target)}</p>
    </div>
    <button type="button" aria-label="取消引用回复" className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onCancel}>
      <X className="size-4" aria-hidden="true" />
    </button>
  </div>;
}

export function ReplyQuote({ roomId, eventId, target, memberMap, onJump }: {
  roomId?: string;
  eventId: string;
  target?: DisplayMessage | null;
  memberMap?: Record<string, string>;
  onJump?: () => void;
}) {
  const { homeserver, accessToken, userId, isLoggedIn } = useMatrixStore();
  const query = useQuery({
    queryKey: ['matrix-reply-target', homeserver, userId, roomId, eventId],
    queryFn: () => matrixApi.getRoomEvent(homeserver!, accessToken!, roomId!, eventId),
    enabled: !target && !!roomId && !!homeserver && !!accessToken && isLoggedIn,
    staleTime: 30_000,
    retry: false,
  });
  const original = target ?? (query.data ? formatMatrixEvent(query.data, userId) : null);
  const sender = original ? memberMap?.[original.sender] || original.senderShort : '';
  const excerpt = original ? messageQuoteExcerpt(original) : query.isFetching ? '正在载入原消息…' : '原消息不可用';
  const className = 'mb-1 w-fit max-w-full space-y-0.5 rounded-r-md border-l-2 border-emerald-500/70 bg-muted/45 px-2.5 py-1.5 text-left text-xs';
  const content = <>
    <span className="block truncate font-medium text-foreground">{sender ? `回复给：${sender}` : '回复了一条消息'}</span>
    <span className="block truncate text-muted-foreground">{excerpt}</span>
  </>;
  return onJump && target
    ? <button type="button" className={`${className} hover:bg-muted`} onClick={(event) => { event.stopPropagation(); onJump(); }}>{content}</button>
    : <div className={className}>{content}</div>;
}
