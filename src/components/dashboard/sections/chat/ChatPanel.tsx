import { useCallback } from 'react';
import { ChatRoom } from './ChatRoom';
import type { RoomInfo } from './room-info';

interface ChatPanelProps {
  room: RoomInfo;
  canSend?: boolean;
  onSendMessage?: (_content: string, _options?: { html?: boolean }) => void;
  className?: string;
}

export function ChatPanel({ room, canSend = true, onSendMessage, className = '' }: ChatPanelProps) {
  const handleSendMessage = useCallback((_content: string, _options?: { html?: boolean }) => {
    onSendMessage?.(_content, _options);
  }, [onSendMessage]);

  return (
    <div className={`flex h-full ${className}`}>
      {/* Main Chat Area */}
      <div className="flex-1 min-w-0">
        <ChatRoom
          roomId={room.id}
          roomName={room.name}
          topic={room.parentTeam ? `团队: ${room.parentTeam}` : undefined}
          canSend={canSend}
          onSendMessage={handleSendMessage}
          className="h-full"
        />
      </div>
    </div>
  );
}
