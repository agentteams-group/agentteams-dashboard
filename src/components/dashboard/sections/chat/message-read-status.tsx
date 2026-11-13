'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { matrixApi, type MatrixEvent } from '@/lib/matrix-api';
import { useMatrixStore } from '@/lib/matrix-store';
import { useMatrixReadReceipts, type DisplayMessage } from '@/hooks/use-matrix';
import { messageReadMembers, messageReadStatusKey, SESSION_RECEIPT_TYPE } from '@/lib/message-read-status';
import { useHumanMatrixIds, useRuntimeMap } from './runtime-map-context';

export const MessageReadRoomContext = createContext('');

export function MessageReadStatus({ message }: { message: DisplayMessage }) {
  const [open, setOpen] = useState(false);
  const openedByClick = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const showMembers = () => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hideMembers = () => {
    if (openedByClick.current) return;
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };
  const roomId = useContext(MessageReadRoomContext);
  const { homeserver, accessToken, userId, isLoggedIn } = useMatrixStore();
  const positions = useMatrixReadReceipts(roomId);
  const humanUserIds = useHumanMatrixIds();
  const runtimeMap = useRuntimeMap();
  const eventId = message.latestEventId || message.eventId || '';
  const key = messageReadStatusKey(homeserver, userId, roomId, eventId);
  const { data = [] } = useQuery({
    queryKey: key,
    enabled: isLoggedIn && !!roomId && !!eventId,
    staleTime: 60_000,
    queryFn: async () => {
      const events: MatrixEvent[] = [];
      let from: string | undefined;
      do {
        const page = await matrixApi.getRoomRelations(homeserver, accessToken, roomId, eventId, SESSION_RECEIPT_TYPE, { limit: 100, from });
        events.push(...page.chunk);
        const next = page.next_batch;
        if (next === from) break;
        from = next;
      } while (from);
      return events;
    },
  });
  const members = messageReadMembers(message, data, positions, humanUserIds, Object.keys(runtimeMap));
  if (members.length === 0) return null;
  const read = members.filter((m) => m.state === 'read');
  const unread = members.filter((m) => m.state === 'unread');
  const summary = members.length === 1
    ? `${members[0].displayName} ${read.length ? '已读' : '未读'}`
    : `已读 ${read.length} · 未读 ${unread.length}`;

  return (
    <Popover open={open} onOpenChange={(nextOpen) => { openedByClick.current = false; setOpen(nextOpen); }}>
      <PopoverTrigger asChild>
        <button type="button" onMouseEnter={showMembers} onMouseLeave={hideMembers} onClick={(event) => { event.preventDefault(); event.stopPropagation(); openedByClick.current = true; showMembers(); }} className="mt-1 inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`消息阅读状态：${summary}`}>
          {members.length === 1 ? <span className={`truncate ${read.length ? 'text-emerald-600' : ''}`}>{summary}</span> : <><span className="text-emerald-600">已读 {read.length}</span><span>·</span><span>未读 {unread.length}</span></>}
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align={message.isMe ? 'end' : 'start'} avoidCollisions={false} onMouseEnter={showMembers} onMouseLeave={hideMembers} onClick={(event) => event.stopPropagation()} onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()} className="w-max max-w-[calc(100vw-2rem)] border border-border/50 p-1.5 shadow-none">
        <ul aria-label="阅读成员" className="max-h-64 space-y-1.5 overflow-y-auto">
          {members.map((member) => <li key={member.userId} className="flex min-w-0 items-center gap-2 text-xs"><span className="w-[4em] shrink-0 truncate" title={member.displayName}>{member.displayName}</span><span className={`shrink-0 ${member.state === 'read' ? 'text-emerald-600' : 'text-muted-foreground'}`}>{member.state === 'read' ? '已读' : '未读'}</span></li>)}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
