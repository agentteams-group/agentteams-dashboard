'use client';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { WorkerSessionCornerDot } from '@/components/worker-session-dot';
import type { RoomMember } from '@/hooks/use-matrix';
import type { WorkerSessionState } from '@/lib/worker-session-state';

interface MembersPanelProps {
  roomMembers: RoomMember[];
  senderStatusMap: Record<string, WorkerSessionState>;
}

/** 房间成员 body（无面板外框）：数据 = Matrix room members + Worker 心跳。 */
export function MembersPanel({ roomMembers, senderStatusMap }: MembersPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="shrink-0 px-3 py-2 text-[10px] font-semibold tracking-wide text-muted-foreground">
        成员 ({roomMembers.length})
      </p>
      <div className="flex-1 space-y-0.5 overflow-y-auto custom-scrollbar p-2 pt-0">
        {roomMembers.map((member) => {
          const color = member.userId.split(':').pop() === 'agentteams.io'
            ? 'text-emerald-600'
            : 'text-muted-foreground';
          return (
            <div
              key={member.userId}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-accent"
              onClick={() => {
                navigator.clipboard.writeText(member.userId);
              }}
              title="点击复制用户ID"
            >
              <span className="relative inline-flex shrink-0">
                <Avatar className="h-6 w-6 shrink-0">
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
                <p className="truncate text-xs font-medium">{member.displayName}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
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
