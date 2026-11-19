'use client';

import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useRoomMetaStore } from '@/hooks/use-matrix';
import { canOpenConversation } from './agent-conversations';
import { TaskAttention, type ConversationAttention } from './conversation-switcher';
import type { RoomInfo } from './room-info';

export function TeamRoomList({ rooms, selectedRoomId, onSelectRoom, isLoading, attention, attentionPending }: {
  rooms: RoomInfo[];
  selectedRoomId: string | null;
  onSelectRoom: (_roomId: string) => void;
  isLoading: boolean;
  attention: Record<string, ConversationAttention>;
  attentionPending?: string;
}) {
  const choices = rooms.filter(room => room.type === 'team');
  return <div className="max-h-[min(480px,65dvh)] overflow-y-auto p-2">
    {isLoading ? <div role="status" aria-label="正在加载团队">{[0, 1, 2].map(key => <Skeleton key={key} className="mb-1 h-10 rounded-lg" />)}</div>
      : choices.length ? <ul aria-label="我的团队" className="space-y-0.5">
        {choices.map(room => {
          const name = room.team?.teamName || room.parentTeam || room.name;
          return <li key={room.id}><Button variant={room.id === selectedRoomId ? 'secondary' : 'ghost'}
            aria-pressed={room.id === selectedRoomId} disabled={!canOpenConversation(room)} title={name}
            className="h-auto min-h-10 w-full justify-start gap-2 rounded-lg px-2 py-2 text-left"
            onClick={() => { if (room.unreadCount) useRoomMetaStore.getState().clearUnread(room.id); onSelectRoom(room.id); }}>
            <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm">{name}</span><TaskAttention counts={attention[room.id]} /></span>
            <span className="shrink-0 text-xs font-normal text-muted-foreground">{room.teamRole === 'admin' ? '管理员' : room.teamRole === 'member' ? '成员' : ''}</span>
            {!!room.unreadCount && <span aria-label={`${room.unreadCount} 条未读消息`} className="shrink-0 rounded-full bg-muted px-1.5 text-xs">{room.unreadCount}</span>}
          </Button></li>;
        })}
      </ul> : <p className="px-2 py-4 text-xs text-muted-foreground">暂无已加入的团队</p>}
    {attentionPending && <p role="status" className="px-2 py-1 text-xs text-muted-foreground">{attentionPending}</p>}
  </div>;
}
