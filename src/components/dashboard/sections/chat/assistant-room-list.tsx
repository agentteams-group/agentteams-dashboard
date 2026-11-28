'use client';

import { Bot, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { canOpenConversation, LEADER_ACCESS_LABELS } from './agent-conversations';
import type { RoomInfo } from './room-info';

export function AssistantRoomList({ rooms, selectedRoomId, onSelectRoom }: {
  rooms: RoomInfo[]; selectedRoomId: string | null; onSelectRoom: (_roomId: string) => void;
}) {
  const groups = [
    { label: 'AgentTeams助手', role: 'operations', empty: '当前账号没有可用的 AgentTeams助手私聊。' },
    { label: '团队助手', role: 'leader', empty: '团队助手仅对你担任 Team Admin 的团队开放。' },
  ];
  return <div className="max-h-[min(480px,65dvh)] space-y-3 overflow-y-auto p-2">
    {groups.map(group => {
      const choices = rooms.filter(room => room.agentRole === group.role);
      const Icon = group.role === 'operations' ? Bot : Users;
      return <section key={group.role} aria-label={group.label}>
        <h3 className="px-2 py-1 text-xs font-medium text-muted-foreground">{group.label}</h3>
        {choices.length ? choices.map(room => <Button key={room.id} variant={room.id === selectedRoomId ? 'secondary' : 'ghost'}
          aria-pressed={room.id === selectedRoomId} disabled={!canOpenConversation(room)}
          className="h-auto min-h-11 w-full justify-start whitespace-normal px-2 py-2 text-left" onClick={() => onSelectRoom(room.id)}>
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0"><span className="block truncate text-sm">{room.name}</span>
            {!canOpenConversation(room) && room.access && room.access !== 'joined' && <span className="block text-xs text-muted-foreground">{LEADER_ACCESS_LABELS[room.access]}</span>}
          </span>
        </Button>) : <p className="px-2 py-2 text-xs leading-5 text-muted-foreground">{group.empty}</p>}
      </section>;
    })}
  </div>;
}
