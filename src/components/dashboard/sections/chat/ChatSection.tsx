'use client';

import { ChatPanel } from './ChatPanel';

interface ChatSectionProps {
  _roomId?: string;
  _selectedRoomId?: string;
  onSelectRoom?: (_roomId: string) => void;
  canSend?: boolean;
  onSendMessage?: (_content: string, _options?: { html?: boolean }) => void;
  className?: string;
}

export function ChatSection({
  _roomId,
  _selectedRoomId,
  onSelectRoom,
  canSend,
  onSendMessage,
  className,
}: ChatSectionProps) {
  return (
    <div className={`flex flex-col h-full ${className}`}>
      <ChatPanel
        onSelectRoom={onSelectRoom}
        canSend={canSend}
        onSendMessage={onSendMessage}
      />
    </div>
  );
}
