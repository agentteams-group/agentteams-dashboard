'use client';

import dynamic from 'next/dynamic';
import type { ReactNode } from 'react';
import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { platformAssistantSettingsHash } from '@/lib/nav-hash';
import type { ChatContextPanel } from './ChatRoom';
import type { RoomInfo } from './room-info';
import type { MentionEntry } from './chat-composer';
import styles from './agent-conversation.module.css';
import { useRoomTaskData, type RoomTaskBoard } from './components/RoomTasksPanel';
import { ManagerModelGate } from './manager-model-gate';
import { RoomArchiveAction } from './room-archive';
import { useRoomArchiveStatus } from '@/hooks/use-room-archive';
import { AssistantReminderSettings } from './assistant-reminder-settings';

const ChatRoom = dynamic(
  () => import('./ChatRoom').then((module) => ({ default: module.ChatRoom })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground" role="status">
        正在加载房间…
      </div>
    ),
  },
);

export type { ChatContextPanel } from './ChatRoom';

interface ChatPanelProps {
  room: RoomInfo;
  taskId?: string;
  contextPanel: ChatContextPanel;
  onContextPanelChange: (_panel: ChatContextPanel) => void;
  canSend?: boolean;
  onSendMessage?: (_content: string, _options?: { html?: boolean }, _mentions?: MentionEntry[]) => void;
  className?: string;
  taskBoard?: RoomTaskBoard;
  headerLeading?: ReactNode;
  headerTitle?: ReactNode;
  headerActions?: ReactNode;
  managerName?: string;
}

export function ChatPanel({
  room,
  taskId,
  contextPanel,
  onContextPanelChange,
  canSend = true,
  onSendMessage,
  className = '',
  taskBoard,
  headerLeading,
  headerTitle,
  headerActions,
  managerName,
}: ChatPanelProps) {
  const userLevel = useAgentTeamsStore(state => state.userLevel);
  const archiveStatus = useRoomArchiveStatus(room.id);
  const roomTaskData = useRoomTaskData(room.id, taskBoard);
  const workerId = room.type === 'worker' ? room.workerName : undefined;
  const topic = [
    workerId && `ID ${workerId}`,
    room.parentTeam && `团队: ${room.parentTeam}`,
  ].filter(Boolean).join(' · ');
  const renderPanel = (configured = true) => (
    <div className={`${styles.conversation} relative flex h-full min-w-0 ${className}`}>
      <div className="flex-1 min-w-0">
        <ChatRoom
          taskRoom={!!taskId || archiveStatus.data?.is_task_room === true}
          taskId={taskId}
          headerLeading={headerLeading}
          headerTitle={headerTitle}
          integratedSidebar={!!room.agentRole || room.type === 'team'}
          roomId={room.id}
          roomName={room.name}
          roomWorkerName={room.workerName}
          agentRole={room.agentRole}
          roomTaskData={taskBoard ? roomTaskData : undefined}
          managedTeam={room.team?.name ?? room.parentTeam}
          managedTeamLabel={room.team?.teamName}
          team={room.team}
          workerMatrixUserIds={room.workerMatrixUserIds ?? (room.matrixUserId ? [room.matrixUserId] : undefined)}
          roomPhase={room.phase}
          roomRuntime={room.runtime}
          topic={topic || undefined}
          headerActions={<>
            {headerActions}
            {room.agentRole && <AssistantReminderSettings roomId={room.id} team={room.agentRole === 'leader' ? room.parentTeam : undefined} manager={managerName} />}
            <RoomArchiveAction room={room} />
            {room.agentRole === 'operations' && managerName && userLevel >= 3 && <Button size="sm" variant="ghost" aria-label="平台助手设置" title="平台助手设置"
              onClick={() => { window.location.hash = platformAssistantSettingsHash(managerName); }}><Settings className="size-4" /><span className="hidden lg:inline">设置</span></Button>}
          </>}
          contextPanel={contextPanel}
          onContextPanelChange={onContextPanelChange}
          canSend={canSend && configured && !(archiveStatus.data?.archived ?? room.archived)}
          onSendMessage={onSendMessage}
          className="h-full"
        />
      </div>
    </div>
  );
  return managerName ? <ManagerModelGate name={managerName}>{renderPanel}</ManagerModelGate> : renderPanel();
}
