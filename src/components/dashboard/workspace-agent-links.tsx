'use client';

import { Bot, ShieldCheck } from 'lucide-react';
import { useRoomMetaStore } from '@/hooks/use-matrix';
import { openChatRoom } from '@/lib/open-chat-room';
import type { RoomInfo } from './sections/chat/room-info';

export function WorkspaceAgentLinks({ rooms = [], collapsed = false, activeSection, onNavigate }: {
  rooms?: RoomInfo[];
  collapsed?: boolean;
  activeSection: string;
  onNavigate: (_section: string) => void;
}) {
  const activeRoomId = useRoomMetaStore((state) => state.activeRoomId);
  return (
    <div className="mb-5 px-2">
      {!collapsed && <p className="mb-2 px-3 text-xs font-medium text-muted-foreground">你的 Agent</p>}
      {rooms.map((room) => {
        const operations = room.agentRole === 'operations';
        const Icon = operations ? ShieldCheck : Bot;
        const label = operations ? '平台助手' : room.name;
        const selected = activeSection === 'chat' && activeRoomId === room.id;
        return (
          <button
            key={room.id}
            type="button"
            title={label}
            aria-label={`与${label}对话`}
            aria-current={selected ? 'page' : undefined}
            onClick={() => { onNavigate('chat'); openChatRoom(room.id); }}
            className={`mb-1 flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary ${selected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'}`}
          >
            <span className={`flex size-8 shrink-0 items-center justify-center rounded-xl ${selected ? 'bg-primary/15' : 'bg-primary/8 text-primary'}`}><Icon className="size-4" /></span>
            {!collapsed && <span className="min-w-0"><span className="block truncate text-sm font-medium">{label}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{operations ? '平台管理与运维' : 'Team Leader · 团队协作'}</span></span>}
          </button>
        );
      })}
      {!collapsed && rooms.length === 0 && <p className="px-3 py-3 text-xs leading-6 text-muted-foreground">可用的助手将在这里显示</p>}
    </div>
  );
}
