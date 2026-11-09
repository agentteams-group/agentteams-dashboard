'use client';

import { MessagesSquare, PanelRightClose } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DisplayMessage, RoomMember } from '@/hooks/use-matrix';
import type { TeamResponse } from '@/lib/agentteams-api';
import type { WorkerSessionState } from '@/lib/worker-session-state';
import type { RoomInfo } from '../room-info';
import { RoomTopology } from '../room-topology';
import { HumanPanel } from '../human-panel';
import { ThreadPanel } from '../structures/ThreadPanel';
import { FilesPanel, type WorkerFileOption } from './WorkersFilesSidebar';
import { MembersPanel } from './MembersSidebar';
import { RoomTasksPanel } from './RoomTasksPanel';
import { RoomContextTabs } from './RoomContextTabs';

export type RoomContextTab = 'overview' | 'tasks' | 'members' | 'files' | 'thread';

interface RoomContextPanelProps {
  onShowNotes?: () => void;
  roomId: string;
  team?: TeamResponse;
  rooms: RoomInfo[];
  activeTab: RoomContextTab;
  onTabChange: (_tab: RoomContextTab) => void;
  onClose: () => void;
  roomMembers: RoomMember[];
  senderStatusMap: Record<string, WorkerSessionState>;
  workerOptions: WorkerFileOption[];
  effectiveSelectedWorker: string | null;
  selectedIsTeamShared: boolean;
  onSelectWorker: (_worker: string | null) => void;
  activeThread: DisplayMessage | null;
  threadRoots: DisplayMessage[];
  onOpenThread: (_message: DisplayMessage) => void;
  memberMap?: Record<string, string>;
  workerMatrixUserIds?: string[];
}

/**
 * 房间右侧唯一的上下文面板（320px）：任务/成员/文件/话题/概览共用一条
 * tab 头与关闭按钮，数据全部来自 AgentTeams 底座（Matrix + Controller），
 * <lg 统一收成右侧抽屉 —— 不再出现宽度 208/320/256~600 三套侧栏。
 */
export function RoomContextPanel({
  roomId,
  team,
  rooms,
  activeTab,
  onTabChange,
  onClose,
  roomMembers,
  senderStatusMap,
  workerOptions,
  effectiveSelectedWorker,
  selectedIsTeamShared,
  onSelectWorker,
  activeThread,
  threadRoots,
  onOpenThread,
  memberMap,
  workerMatrixUserIds,
  onShowNotes,
}: RoomContextPanelProps) {
  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-border bg-card max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:w-[min(20rem,85vw)] max-lg:shadow-xl">
      <RoomContextTabs activeTab={activeTab} includeNotes={!!onShowNotes} onTabChange={tab => tab ? onTabChange(tab) : onShowNotes?.()} memberCount={roomMembers.length} threadCount={threadRoots.length}>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 w-6 shrink-0 p-0"
          onClick={onClose}
          title="关闭面板"
          aria-label="关闭上下文面板"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </Button>
      </RoomContextTabs>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'tasks' && <RoomTasksPanel roomId={roomId} />}

        {activeTab === 'members' && (
          <MembersPanel roomMembers={roomMembers} senderStatusMap={senderStatusMap} />
        )}

        {activeTab === 'files' && (
          <FilesPanel
            team={team}
            workerOptions={workerOptions}
            effectiveSelectedWorker={effectiveSelectedWorker}
            selectedIsTeamShared={selectedIsTeamShared}
            onSelectWorker={onSelectWorker}
          />
        )}

        {activeTab === 'thread' && (
          activeThread ? (
            <ThreadPanel
              roomId={roomId}
              rootMessage={activeThread}
              memberMap={memberMap}
              workerMatrixUserIds={workerMatrixUserIds}
            />
          ) : (
            <ThreadList roots={threadRoots} memberMap={memberMap} onOpen={onOpenThread} />
          )
        )}

        {activeTab === 'overview' && (
          <div className="h-full space-y-3 overflow-y-auto custom-scrollbar p-2">
            <RoomTopology rooms={rooms} selectedRoomId={roomId} members={roomMembers} />
            <HumanPanel />
          </div>
        )}
      </div>
    </aside>
  );
}

function ThreadList({
  roots,
  memberMap,
  onOpen,
}: {
  roots: DisplayMessage[];
  memberMap?: Record<string, string>;
  onOpen: (_message: DisplayMessage) => void;
}) {
  if (roots.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <MessagesSquare className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
        <p className="text-xs font-medium">本空间暂无回复话题</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          在任意消息上使用「回复」开启话题，集中讨论同一项工作。
        </p>
      </div>
    );
  }

  return (
    <div className="h-full space-y-1.5 overflow-y-auto custom-scrollbar p-2">
      {roots.map((root) => (
        <button
          key={root.id}
          type="button"
          onClick={() => onOpen(root)}
          className="w-full rounded-lg border border-border/60 px-2.5 py-2 text-left transition-colors hover:bg-accent/50"
        >
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-xs font-medium">
              {memberMap?.[root.sender] ?? root.senderShort}
            </span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {root.replyCount} 条回复
            </span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {root.content.slice(0, 80)}
          </span>
        </button>
      ))}
    </div>
  );
}
