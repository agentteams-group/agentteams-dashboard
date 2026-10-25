import { ChatRoom, type ChatContextPanel } from './ChatRoom';
import type { RoomInfo } from './room-info';
import type { MentionEntry } from './chat-composer';

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
}

export function ChatPanel({
  room,
  rooms,
  contextPanel,
  onContextPanelChange,
  canSend = true,
  onSendMessage,
  className = '',
}: ChatPanelProps) {
  return (
    <div className={`flex h-full min-w-0 ${className}`}>
      <div className="flex-1 min-w-0">
        <ChatRoom
          roomId={room.id}
          roomName={room.name}
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
    </div>
  );
}
