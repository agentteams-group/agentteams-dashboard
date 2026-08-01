import { useCallback, useMemo, useState } from 'react';
import { useChatStore } from './ChatStore';
import { ChatRoom } from './ChatRoom';
import { useMatrixJoinedRooms } from '@/hooks/use-matrix';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { RoomInfo } from './room-info';

interface ChatPanelProps {
  room: RoomInfo;
  canSend?: boolean;
  onSendMessage?: (_content: string, _options?: { html?: boolean }) => void;
  className?: string;
}

export function ChatPanel({ room, canSend = true, onSendMessage, className = '' }: ChatPanelProps) {
  const { currentRoomId, setCurrentRoomId } = useChatStore();
  const joinedRoomsQuery = useMatrixJoinedRooms();
  const [selectedId] = useState(room.id);

  // Build room list from joined rooms
  const roomList = useMemo<RoomInfo[]>(() => {
    if (joinedRoomsQuery.data) {
      return joinedRoomsQuery.data.joined_rooms.map(roomId => ({
        roomId,
        name: roomId,
        type: 'worker' as const,
        members: [],
        unreadCount: 0,
      }));
    }
    return [];
  }, [joinedRoomsQuery.data]);

  const handleSendMessage = useCallback((_content: string, _options?: { html?: boolean }) => {
    onSendMessage?.(_content, _options);
  }, [onSendMessage]);

  return (
    <div className={`flex h-full ${className}`}>
      {/* Main Chat Area */}
      <div className="flex-1 min-w-0">
        <ChatRoom
          roomId={selectedId}
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
