import { ChatRoom, type ChatContextPanel } from './ChatRoom';
import type { RoomInfo } from './room-info';
import type { MentionEntry } from './chat-composer';
import styles from './agent-conversation.module.css';
import { AssistantTaskNote } from './components/AssistantTaskNote';
import type { AssistantTaskFeed } from '@/hooks/use-assistant-task-feed';
import { useMatrixRoomMembers } from '@/hooks/use-matrix';

export type { ChatContextPanel } from './ChatRoom';

interface ChatPanelProps {
  room: RoomInfo;
  /** All rooms in the workspace — powers the 概览 tab topology. */
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
  const members = useMatrixRoomMembers(room.id);
  const memberCount = members.data?.chunk.filter(event => event.content?.membership === 'join').length ?? 0;
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
          rooms={rooms}
          contextPanel={contextPanel}
          onContextPanelChange={onContextPanelChange}
          canSend={canSend}
          onSendMessage={onSendMessage}
          className="h-full"
        />
      </div>
      {contextPanel === null && (room.agentRole || room.type === 'team') && <AssistantTaskNote room={room} rooms={rooms ?? [room]} contextOpen={false} onOpen={() => onContextPanelChange(null)} taskFeed={taskFeed} onTabChange={onContextPanelChange} memberCount={memberCount} />}
    </div>
  );
}
