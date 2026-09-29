'use client';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Users, UserCheck, FolderTree } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WorkerSessionDot } from '@/components/worker-session-dot';
import type { TeamResponse } from '@/lib/agentteams-api';
import { RUNTIME_LABELS } from '@/lib/phase-colors';
import type { WorkerSessionState } from '@/lib/worker-session-state';

interface ChatRoomHeaderProps {
  roomName: string;
  /** Full AgentTeams team resource for team rooms (drives the header detail). */
  team?: TeamResponse;
  /** Worker phase shown in the conversation header. */
  roomPhase?: string;
  /** Worker runtime shown in the conversation header. */
  roomRuntime?: string;
  /** Worker MXIDs of this room — drives the session dot (A17):
   *  one MXID = 1:1 room (three states), several = team room (running
   *  only). Omitted for manager/human rooms (no dot). */
  workerMatrixUserIds?: string[];
  topic?: string;
  avatar?: string;
  sessionDot: { state: WorkerSessionState; runningOnly: boolean };
  memberCount: number;
  showMembers: boolean;
  showWorkers: boolean;
  onToggleMembers: () => void;
  onToggleWorkers: () => void;
}

export function ChatRoomHeader({
  roomName,
  team,
  topic,
  avatar,
  roomPhase,
  roomRuntime,
  workerMatrixUserIds,
  sessionDot,
  memberCount,
  showMembers,
  showWorkers,
  onToggleMembers,
  onToggleWorkers,
}: ChatRoomHeaderProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b bg-card/70 backdrop-blur-sm">
      {avatar ? (
        <Avatar className="w-8 h-8 shrink-0">
          <img src={avatar} alt={roomName} />
        </Avatar>
      ) : (
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/90 to-primary/55 flex items-center justify-center shadow-sm">
           <span className="text-xs font-semibold text-primary-foreground">{roomName.charAt(0).toUpperCase()}</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <h3 className="font-semibold text-sm truncate">{roomName}</h3>
          {workerMatrixUserIds && workerMatrixUserIds.length > 0
            ? sessionDot.runningOnly
              ? sessionDot.state === 'running'
                ? <WorkerSessionDot state="running" />
                : null
              : <WorkerSessionDot state={sessionDot.state} />
            : null}
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="实时同步" />
          {roomPhase && (
            <Badge variant="outline" className="text-[11px] px-1 py-0 h-4 shrink-0">
              {roomPhase}
            </Badge>
          )}
          {roomRuntime && (
            <Badge variant="secondary" className="text-[11px] px-1 py-0 h-4 shrink-0">
              {RUNTIME_LABELS[roomRuntime] || roomRuntime}
            </Badge>
          )}
        </div>
        {team ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
            <span className="inline-flex items-center gap-1 shrink-0">
              <Users className="w-3 h-3" />
              {team.teamName || team.name}
            </span>
            {team.description && (
              <span className="truncate" title={team.description}>{team.description}</span>
            )}
            <span className="shrink-0 inline-flex items-center gap-1" title="就绪 Worker / 总 Worker">
              <UserCheck className="w-3 h-3 text-emerald-500" />
              {team.readyWorkers}/{team.totalWorkers}
            </span>
            {team.leaderName && (
              <span className="shrink-0">Leader: {team.leaderName}</span>
            )}
          </div>
        ) : (
          topic && (
            <p className="text-xs text-muted-foreground truncate">{topic}</p>
          )
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 shrink-0"
        onClick={onToggleMembers}
        title={showMembers ? '隐藏成员' : '显示成员'}
      >
        <Badge variant="secondary" className="text-xs cursor-pointer hover:bg-primary/10">
          <Users className="w-3 h-3 mr-1" />
          {memberCount}
        </Badge>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 shrink-0"
        onClick={onToggleWorkers}
        title={showWorkers ? '隐藏工作目录' : '显示工作目录'}
      >
        <FolderTree className="w-4 h-4" />
      </Button>
    </div>
  );
}
