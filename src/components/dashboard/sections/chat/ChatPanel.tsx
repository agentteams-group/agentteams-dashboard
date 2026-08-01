import { useCallback } from 'react';
import { ChatRoom } from './ChatRoom';
import type { RoomInfo } from './room-info';
import type { MentionEntry } from './chat-composer';

interface ChatPanelProps {
  room: RoomInfo;
  canSend?: boolean;
  onSendMessage?: (_content: string, _options?: { html?: boolean }, _mentions?: MentionEntry[]) => void;
  className?: string;
}

export function ChatPanel({ room, canSend = true, onSendMessage, className = '' }: ChatPanelProps) {
  const handleSendMessage = useCallback((content: string, options?: { html?: boolean }, mentions?: MentionEntry[]) => {
    onSendMessage?.(content, options, mentions);
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
