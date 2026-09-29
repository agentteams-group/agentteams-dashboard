'use client';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { PanelRightClose } from 'lucide-react';
import { WorkerSessionCornerDot } from '@/components/worker-session-dot';
import type { RoomMember } from '@/hooks/use-matrix';
import type { WorkerSessionState } from '@/lib/worker-session-state';

interface MembersSidebarProps {
  roomMembers: RoomMember[];
  senderStatusMap: Record<string, WorkerSessionState>;
  onClose: () => void;
}

export function MembersSidebar({ roomMembers, senderStatusMap, onClose }: MembersSidebarProps) {
  return (
    <div className="w-52 shrink-0 border-l border-border bg-card overflow-hidden flex flex-col">
      <div className="px-3 py-2.5 border-b border-border shrink-0 flex items-center justify-between">
        <h4 className="font-semibold text-xs">成员 ({roomMembers.length})</h4>
        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={onClose}>
          <PanelRightClose className="w-3 h-3" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5 custom-scrollbar">
        {roomMembers.map((member) => {
          const color = member.userId.split(':').pop() === 'agentteams.io'
            ? 'text-emerald-600'
            : 'text-muted-foreground';
          return (
            <div
              key={member.userId}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer"
              onClick={() => {
                navigator.clipboard.writeText(member.userId);
              }}
              title="点击复制用户ID"
            >
              <span className="relative inline-flex shrink-0">
                <Avatar className="w-6 h-6 shrink-0">
                  <AvatarFallback className={`text-[10px] ${color}`}>
                    {member.displayName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {/* A17（9/19）：成员列表头像角落状态灯（与消息头像同款
                    WorkerSessionCornerDot；人类成员无映射不显）。 */}
                {senderStatusMap[member.userId] && (
                  <WorkerSessionCornerDot state={senderStatusMap[member.userId]} ringClassName="ring-card" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate">{member.displayName}</p>
                <p className="text-[11px] text-muted-foreground font-mono truncate">
                  {member.userId.split(':')[0].slice(1)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
