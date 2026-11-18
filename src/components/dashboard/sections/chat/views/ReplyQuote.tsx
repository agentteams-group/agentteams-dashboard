'use client';

import { useQuery } from '@tanstack/react-query';
import { CornerUpLeft, X } from 'lucide-react';
import type { MouseEventHandler } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatMatrixEvent, type DisplayMessage } from '@/hooks/use-matrix';
import { matrixApi } from '@/lib/matrix-api';
import { useMatrixStore } from '@/lib/matrix-store';

function originalText(message: DisplayMessage) {
  return message.content.trim() || (message.mediaUrl ? '附件' : '消息');
}

function QuoteLine({ sender, text, onClick }: {
  sender?: string;
  text: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}) {
  const letters = Array.from(text.split(/\r?\n/, 1)[0].replace(/\s+/g, ' '));
  const short = letters.slice(0, 18).join('') + (letters.length > 18 || text.includes('\n') ? '…' : '');
  const className = 'inline-flex w-fit min-w-0 max-w-[min(100%,22rem)] items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1 text-left text-xs text-muted-foreground';
  const label = <>
    <CornerUpLeft className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
    <span className="max-w-[48%] shrink-0 truncate font-medium text-foreground">{sender ? `回复给：${sender}` : '回复了一条消息'}</span>
    <span className="min-w-0 truncate">{short}</span>
  </>;
  return <Tooltip>
    <TooltipTrigger asChild>
      {onClick
        ? <button type="button" className={`${className} hover:bg-muted`} onClick={onClick}>{label}</button>
        : <span tabIndex={0} className={className}>{label}</span>}
    </TooltipTrigger>
    <TooltipContent side="top" sideOffset={6} className="max-h-[min(20rem,50vh)] max-w-[min(24rem,85vw)] overflow-auto whitespace-pre-wrap break-words text-left text-pretty">
      {text}
    </TooltipContent>
  </Tooltip>;
}

export function ComposerReply({ target, memberMap, onCancel }: {
  target: DisplayMessage;
  memberMap?: Record<string, string>;
  onCancel: () => void;
}) {
  const sender = memberMap?.[target.sender] || target.senderShort;
  return <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1">
    <QuoteLine sender={sender} text={originalText(target)} />
    <button type="button" aria-label="取消引用回复" className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onCancel}>
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
  const text = original ? originalText(original) : query.isFetching ? '正在载入原消息…' : '原消息不可用';
  return <QuoteLine sender={sender} text={text}
    onClick={onJump && target ? (event) => { event.stopPropagation(); onJump(); } : undefined} />;
}
