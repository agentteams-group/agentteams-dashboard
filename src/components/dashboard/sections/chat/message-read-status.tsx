'use client';

import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCheck } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { matrixApi, type MatrixEvent } from '@/lib/matrix-api';
import { useMatrixStore } from '@/lib/matrix-store';
import { useMatrixReadReceipts, type DisplayMessage } from '@/hooks/use-matrix';
import { messageReadMembers, messageReadStatusKey, SESSION_RECEIPT_TYPE } from '@/lib/message-read-status';
import { useHumanMatrixIds, useRuntimeMap } from './runtime-map-context';

export const MessageReadRoomContext = createContext('');

export function MessageReadStatus({ message }: { message: DisplayMessage }) {
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
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="mt-1 inline-flex max-w-full items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`消息阅读状态：${summary}`}>
          <CheckCheck className={`h-3.5 w-3.5 shrink-0 ${read.length ? 'text-emerald-600' : ''}`} aria-hidden="true" />
          <span className="truncate">{summary}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" collisionPadding={12} className="w-72 max-w-[calc(100vw-2rem)] p-3">
        <p className="text-sm font-semibold">消息阅读状态</p>
        <p className="mt-1 text-xs text-muted-foreground">Agent 加入会话后记为已读</p>
        <div className="mt-3 max-h-64 space-y-3 overflow-y-auto">
          {([{ title: '已读', items: read }, { title: '未读', items: unread }]).map(({ title, items }) => (
            <section key={title} aria-label={`${title}成员`}>
              <p className="text-xs font-medium text-muted-foreground">{title} {items.length}</p>
              {items.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">暂无</p> : (
                <ul className="mt-1 space-y-1.5">
                  {items.map((member) => <li key={member.userId} className="flex min-w-0 items-center justify-between gap-3 text-sm"><span className="truncate" title={member.userId}>{member.displayName}</span><span className="shrink-0 text-xs text-muted-foreground">{member.kind === 'agent' ? 'Agent' : '成员'}</span></li>)}
                </ul>
              )}
            </section>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
