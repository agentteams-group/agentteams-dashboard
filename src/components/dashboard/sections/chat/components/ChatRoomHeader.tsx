'use client';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  FolderTree,
  ListTodo,
  MessagesSquare,
  PanelRightClose,
  PanelRightOpen,
  UserCheck,
  Users,
} from 'lucide-react';
import { WorkerSessionDot } from '@/components/worker-session-dot';
import type { TeamResponse } from '@/lib/agentteams-api';
import { RUNTIME_LABELS } from '@/lib/phase-colors';
import type { WorkerSessionState } from '@/lib/worker-session-state';
import type { RoomContextTab } from './RoomContextPanel';

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
  threadCount: number;
  activePanel: RoomContextTab | null;
  onTogglePanel: (_panel: RoomContextTab) => void;
}

function ContextChip({
  active,
  icon: Icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: typeof Users;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <Button
      variant={active ? 'secondary' : 'outline'}
      size="sm"
      className="h-7 gap-1 px-2 text-[11px]"
      onClick={onClick}
      title={`${active ? '隐藏' : '显示'}${label}`}
      aria-pressed={active}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden lg:inline">{label}</span>
      {typeof count === 'number' && count > 0 && <span className="font-mono">{count}</span>}
    </Button>
  );
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
  threadCount,
  activePanel,
  onTogglePanel,
}: ChatRoomHeaderProps) {
  const teamName = team ? team.teamName || team.name : '';
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 overflow-hidden border-b border-border bg-card/70 px-4 backdrop-blur-sm sm:px-6">
      {avatar ? (
        <Avatar className="w-9 h-9 shrink-0 rounded-[10px]">
          <img src={avatar} alt={roomName} />
        </Avatar>
      ) : (
        <div className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-primary/90 to-primary/55 flex items-center justify-center shadow-sm shrink-0">
          <span className="text-xs font-semibold text-primary-foreground">{roomName.charAt(0).toUpperCase()}</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <h3 className="font-semibold text-base leading-tight truncate" title={team?.description || roomName}>{roomName}</h3>
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
          <div className="flex min-w-0 items-center gap-2 text-[11.5px] text-muted-foreground">
            {teamName && teamName !== roomName && (
              <span className="inline-flex min-w-0 shrink items-center gap-1" title={teamName}>
                <Users className="w-3 h-3 shrink-0" />
                <span className="truncate">{teamName}</span>
              </span>
            )}
            <span className="inline-flex shrink-0 items-center gap-1" title="就绪 Worker / 总 Worker">
              <UserCheck className="w-3 h-3 text-emerald-500" />
              {team.readyWorkers}/{team.totalWorkers} Worker
            </span>
            {team.leaderName && (
              <>
                <span aria-hidden="true" className="shrink-0 text-muted-foreground/60">·</span>
                <span className="shrink-0 truncate text-muted-foreground">Leader {team.leaderName}</span>
              </>
            )}
          </div>
        ) : (
          topic && (
            <p className="text-[11.5px] text-muted-foreground truncate">{topic}</p>
          )
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <ContextChip
          active={activePanel === 'tasks'}
          icon={ListTodo}
          label="任务"
          onClick={() => onTogglePanel('tasks')}
        />
        <ContextChip
          active={activePanel === 'members'}
          icon={Users}
          label="成员"
          count={memberCount}
          onClick={() => onTogglePanel('members')}
        />
        <ContextChip
          active={activePanel === 'files'}
          icon={FolderTree}
          label="文件"
          onClick={() => onTogglePanel('files')}
        />
        <ContextChip
          active={activePanel === 'thread'}
          icon={MessagesSquare}
          label="话题"
          count={threadCount}
          onClick={() => onTogglePanel('thread')}
        />
        <Button
          variant={activePanel === 'overview' ? 'secondary' : 'outline'}
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => onTogglePanel('overview')}
          title={activePanel === 'overview' ? '隐藏空间概览' : '显示空间概览'}
          aria-pressed={activePanel === 'overview'}
        >
          {activePanel === 'overview'
            ? <PanelRightClose className="h-3.5 w-3.5" />
            : <PanelRightOpen className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}
