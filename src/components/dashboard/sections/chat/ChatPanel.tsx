import { ChatRoom, type ChatContextPanel } from './ChatRoom';
import type { RoomInfo } from './room-info';
import type { MentionEntry } from './chat-composer';
import styles from './agent-conversation.module.css';
import { AssistantTaskNote } from './components/AssistantTaskNote';
import { RoomContextTabs } from './components/RoomContextTabs';
import type { AssistantTaskFeed } from '@/hooks/use-assistant-task-feed';

export type { ChatContextPanel } from './ChatRoom';

interface ChatPanelProps {
  room: RoomInfo;
  /** Rooms used to scope human intervention tasks. */
  rooms?: RoomInfo[];
  contextPanel: ChatContextPanel;
  onContextPanelChange: (_panel: ChatContextPanel) => void;
  canSend?: boolean;
  onSendMessage?: (_content: string, _options?: { html?: boolean }, _mentions?: MentionEntry[]) => void;
  className?: string;
  taskFeed?: AssistantTaskFeed;
}

export function ChatPanel({
  room,
  rooms,
  contextPanel,
  onContextPanelChange,
  canSend = true,
  onSendMessage,
  className = '',
  taskFeed,
}: ChatPanelProps) {
  return (
    <div className={`${styles.conversation} flex h-full min-w-0 ${className}`}>
      <div className="flex-1 min-w-0">
        <ChatRoom
          integratedSidebar={!!room.agentRole || room.type === 'team'}
          roomId={room.id}
          roomName={room.agentRole === 'operations' ? '平台助手' : room.name}
          agentRole={room.agentRole}
          team={room.team}
          defaultWorkerName={room.workerName}
          workerMatrixUserIds={room.workerMatrixUserIds}
          roomPhase={room.phase}
          roomRuntime={room.runtime}
          topic={room.parentTeam ? `团队: ${room.parentTeam}` : undefined}
          headerActions={(room.agentRole || room.type === 'team') ? <AssistantTaskNote key={room.id} room={room} rooms={rooms ?? [room]} taskFeed={taskFeed} /> : undefined}
          contextPanel={contextPanel}
          onContextPanelChange={onContextPanelChange}
          canSend={canSend}
          onSendMessage={onSendMessage}
          className="h-full"
        />
      </div>
      {contextPanel === null && (room.agentRole || room.type === 'team') && <div className="w-10 shrink-0 border-l border-border bg-muted/20"><RoomContextTabs activeTab={null} vertical showMembers={!room.agentRole} onTabChange={onContextPanelChange} /></div>}

    </div>
  );
}
