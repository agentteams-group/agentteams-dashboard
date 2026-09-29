'use client';

import { motion } from 'framer-motion';
import { Bot, Crown, MessageSquare, UserCheck, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { WorkerSessionDot, WorkerSessionRunningDot } from '@/components/worker-session-dot';
import {
  useRoomRunningState,
  useRoomSessionState,
} from '@/hooks/use-worker-session-state';
import { useRoomMetaStore } from '@/hooks/use-matrix';
import { RUNTIME_LABELS } from '@/lib/phase-colors';
import type { RoomInfo } from './room-info';

const PHASE_COLOR: Record<string, string> = {
  Running: 'text-emerald-500',
  Active: 'text-emerald-500',
  Ready: 'text-emerald-500',
  Sleeping: 'text-amber-500',
  Pending: 'text-amber-500',
  Failed: 'text-red-500',
  Stopped: 'text-gray-500',
};

function roomTypeIcon(type: RoomInfo['type']) {
  switch (type) {
    case 'team':
      return <Users className="w-4 h-4 text-emerald-500" />;
    case 'worker':
      return <Bot className="w-4 h-4 text-emerald-500" />;
    case 'manager':
      return <Crown className="w-4 h-4 text-violet-500" />;
    case 'human':
      return <UserCheck className="w-4 h-4 text-cyan-500" />;
    default:
      // 12.15：通用房间用对话气泡（原先 Hash '#' 像是频道符——装验反馈）。
      return <MessageSquare className="w-4 h-4 text-muted-foreground" />;
  }
}

function statusDot(phase: string | undefined): string {
  if (!phase) return 'bg-gray-400';
  if (phase === 'Running' || phase === 'Active' || phase === 'Ready') return 'bg-emerald-500';
  if (phase === 'Sleeping' || phase === 'Pending') return 'bg-amber-500';
  if (phase === 'Failed') return 'bg-red-500';
  return 'bg-gray-400';
}

export function RoomListItem({
  room,
  isSelected,
  onClick,
}: {
  room: RoomInfo;
  isSelected: boolean;
  onClick: () => void;
}) {
  // Clear the unread red dot immediately on click. The actual m.fully_read
  // upload (and any subsequent server-confirmed reset) is handled by
  // ChatRoom's markAllRead — but doing this here too means the badge
  // disappears the moment the user selects the room, even before the
  // message query resolves.
  const handleClick = () => {
    if (room.unreadCount && room.unreadCount > 0) {
      useRoomMetaStore.getState().clearUnread(room.id);
    }
    onClick();
  };

  // Session dot (A17): 1:1 worker rooms show the full three states
  // (running/done/idle); team rooms only express running — a human
  // message in a team room must never flash green (v1.51 decision).
  // Manager/human rooms get no dot.
  const isWorkerRoom = room.type === 'worker';
  const isTeamRoom = room.type === 'team';
  const workerRoomState = useRoomSessionState(
    isWorkerRoom ? room.id : undefined,
    isWorkerRoom ? room.matrixUserId : undefined,
  );
  const teamRunning = useRoomRunningState(
    isTeamRoom ? room.id : undefined,
    isTeamRoom ? room.workerMatrixUserIds : undefined,
  );
  return (
    <motion.button
      onClick={handleClick}
      className={`w-full text-left p-3 rounded-lg transition-colors ${
        isSelected
          ? 'bg-emerald-500/10 border border-emerald-500/30'
          : 'hover:bg-accent border border-transparent'
      }`}
      whileTap={{ scale: 0.99 }}
    >
      <div className="flex items-center gap-2.5">
        <div className="relative">
          {roomTypeIcon(room.type)}
          {room.phase && PHASE_COLOR[room.phase] && (
            <div
              className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ${statusDot(room.phase)}`}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="font-medium text-sm truncate">{room.name}</p>
            {isWorkerRoom && room.matrixUserId ? (
              <WorkerSessionDot state={workerRoomState} />
            ) : null}
            {isTeamRoom ? (
              <WorkerSessionRunningDot running={teamRunning} />
            ) : null}
            {room.phase ? (
              <Badge
                variant="outline"
                className={`text-[10px] px-1 py-0 h-3.5 shrink-0 ${PHASE_COLOR[room.phase] || ''}`}
              >
                {room.phase}
              </Badge>
            ) : null}
          </div>
          {/* Runtime badge on its own row (below the name) so long room
              names are never pushed off-screen by a second badge. */}
          <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
            {room.runtime ? (
              <Badge
                variant="outline"
                className="text-[10px] px-1 py-0 h-3.5 shrink-0"
                title={room.runtime}
              >
                {RUNTIME_LABELS[room.runtime] || room.runtime}
              </Badge>
            ) : null}
            <p className="text-[10px] text-muted-foreground truncate min-w-0">
              {room.lastMessagePreview || room.parentTeam || room.id}
            </p>
          </div>
        </div>
        {room.unreadCount !== undefined && room.unreadCount > 0 ? (
          <span
            className={`shrink-0 rounded-full ${
              room.unreadHighlightCount
                ? 'h-2.5 w-2.5 bg-red-500 ring-2 ring-red-500/30'
                : 'h-2 w-2 bg-red-500'
            }`}
            aria-label={
              room.unreadHighlightCount
                ? `${room.unreadHighlightCount} 条 @提醒 · ${room.unreadCount} 条未读`
                : `${room.unreadCount} 条未读`
            }
            title={
              room.unreadHighlightCount
                ? `${room.unreadHighlightCount} 条 @提醒 · ${room.unreadCount} 条未读`
                : `${room.unreadCount} 条未读`
            }
          />
        ) : null}
      </div>
    </motion.button>
  );
}
