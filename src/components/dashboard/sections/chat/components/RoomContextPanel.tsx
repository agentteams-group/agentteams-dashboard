'use client';

import type { ReactNode } from 'react';
import { MessagesSquare, PanelRightClose } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DisplayMessage, RoomMember } from '@/hooks/use-matrix';
import type { CollaborationFileScope } from '@/lib/collaboration-files';
import type { WorkerSessionState } from '@/lib/worker-session-state';
import { ThreadPanel } from '../structures/ThreadPanel';
import { FilesBrowserPanel } from '../views/worker-files-panel';
import { MembersPanel } from './MembersSidebar';
import { RoomTasksPanel } from './RoomTasksPanel';
import { RoomContextTabs } from './RoomContextTabs';

export type RoomContextTab = 'tasks' | 'members' | 'files' | 'thread';

interface RoomContextPanelProps {
  canSend?: boolean;
  showMembers?: boolean;
  showTasks?: boolean;
  roomId: string;
  fileScope?: CollaborationFileScope;
  roomAttachments: ReactNode;
  activeTab: RoomContextTab;
  onTabChange: (_tab: RoomContextTab) => void;
  onClose: () => void;
  roomMembers: RoomMember[];
  senderStatusMap: Record<string, WorkerSessionState>;
  activeThread: DisplayMessage | null;
  threadMention?: DisplayMessage | null;
  threadRoots: DisplayMessage[];
  quotedReplies?: DisplayMessage[];
  onBackToThreads: () => void;
  onOpenThread: (_message: DisplayMessage) => void;
  memberMap?: Record<string, string>;
  workerMatrixUserIds?: string[];
}

/**
 * 房间右侧唯一的上下文面板（320px）：任务/成员/文件/话题共用一条
 * tab 头与关闭按钮，数据全部来自 AgentTeams 底座（Matrix + Controller），
 * <lg 统一收成右侧抽屉 —— 不再出现宽度 208/320/256~600 三套侧栏。
 */
export function RoomContextPanel({
  canSend = true,
  roomId,
  fileScope,
  roomAttachments,
  activeTab,
  onTabChange,
  onClose,
  roomMembers,
  senderStatusMap,
  activeThread,
  threadMention,
  threadRoots,
  quotedReplies,
  onBackToThreads,
  onOpenThread,
  memberMap,
  workerMatrixUserIds,
  showMembers = true,
  showTasks = true,
}: RoomContextPanelProps) {
  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-border bg-card max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:w-[min(20rem,85vw)] max-lg:shadow-xl">
      <RoomContextTabs activeTab={activeTab} showMembers={showMembers} showTasks={showTasks} onTabChange={tab => { if (tab) onTabChange(tab); }} memberCount={roomMembers.length} threadCount={threadRoots.length}>
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
          fileScope ? <FilesBrowserPanel key={'team' in fileScope ? fileScope.team : fileScope.room} scope={fileScope} />
            : roomAttachments
        )}

        {activeTab === 'thread' && (
          activeThread ? (
            <ThreadPanel
              key={activeThread.id}
              canSend={canSend}
              roomId={roomId}
              rootMessage={activeThread}
              focusedMessage={threadMention}
              quotedReplies={quotedReplies}
              onBack={onBackToThreads}
              memberMap={memberMap}
              workerMatrixUserIds={workerMatrixUserIds}
            />
          ) : (
            <ThreadList roots={threadRoots} memberMap={memberMap} onOpen={onOpenThread} />
          )
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
