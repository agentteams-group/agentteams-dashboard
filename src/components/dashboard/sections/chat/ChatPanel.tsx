import { useCallback, useMemo, useState } from 'react';
import { useChatStore } from './ChatStore';
import { ChatRoom } from './ChatRoom';
import { useMatrixJoinedRooms } from '@/hooks/use-matrix';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ChatPanelProps {
  _roomId?: string;
  _selectedRoomId?: string;
  onSelectRoom?: (_roomId: string) => void;
  canSend?: boolean;
  onSendMessage?: (_content: string, _options?: { html?: boolean }) => void;
  className?: string;
}

interface RoomInfo {
  roomId: string;
  name: string;
  topic: string;
  lastMessage?: string;
  unreadCount: number;
}

function RoomItem({
  room,
  isSelected,
  onClick,
}: {
  room: RoomInfo;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
        isSelected
          ? 'bg-primary/10 hover:bg-primary/15'
          : 'hover:bg-muted'
      }`}
    >
      <Avatar className="w-8 h-8 shrink-0">
        <div className="w-full h-full rounded-full bg-muted flex items-center justify-center">
          <span className="text-xs font-medium">{room.name.charAt(0).toUpperCase()}</span>
        </div>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className={`text-sm font-medium truncate ${
            isSelected ? 'text-primary' : ''
          }`}>
            {room.name}
          </span>
          {room.unreadCount > 0 && (
            <Badge variant="destructive" className="text-[10px] h-4 min-w-4">
              {room.unreadCount}
            </Badge>
          )}
        </div>
        {room.lastMessage && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {room.lastMessage}
          </p>
        )}
      </div>
    </button>
  );
}

function RoomSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <Skeleton className="w-8 h-8 rounded-full" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-2 w-1/2" />
      </div>
    </div>
  );
}

export function ChatPanel({
  _roomId,
  _selectedRoomId,
  onSelectRoom,
  canSend = true,
  onSendMessage,
  className = '',
}: ChatPanelProps) {
  const { currentRoomId, setCurrentRoomId } = useChatStore();
  const joinedRoomsQuery = useMatrixJoinedRooms();
  const [selectedId, setSelectedId] = useState(currentRoomId || '');

  // Build room list from joined rooms
  const roomList = useMemo<RoomInfo[]>(() => {
    if (joinedRoomsQuery.data) {
      return joinedRoomsQuery.data.joined_rooms.map(roomId => ({
        roomId,
        name: roomId,
        topic: '',
        unreadCount: 0,
      }));
    }
    return [];
  }, [joinedRoomsQuery.data]);

  const handleSelectRoom = useCallback((id: string) => {
    setSelectedId(id);
    setCurrentRoomId(id);
    onSelectRoom?.(id);
  }, [setCurrentRoomId, onSelectRoom]);

  const handleSendMessage = useCallback((_content: string, _options?: { html?: boolean }) => {
    onSendMessage?.(_content, _options);
  }, [onSendMessage]);

  const selectedRoom = roomList.find(r => r.roomId === selectedId);

  if (!selectedRoom && !joinedRoomsQuery.isLoading) {
    return (
      <div className={`flex flex-col h-full ${className}`}>
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <p>选择或创建一个房间</p>
            <p className="text-xs mt-1">在左侧列表中选择对话</p>
          </div>
        </div>
      </div>
    );
  }

  if (joinedRoomsQuery.isLoading) {
    return (
      <div className={`flex h-full ${className}`}>
        <div className="w-48 border-r shrink-0 flex flex-col">
          <div className="p-3 border-b">
            <Skeleton className="h-4 w-20" />
          </div>
          <ScrollArea className="flex-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <RoomSkeleton key={i} />
            ))}
          </ScrollArea>
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <Skeleton className="h-4 w-32 mx-auto mb-2" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      </div>
    );
  }

  if (!selectedRoom) return null;

  return (
    <div className={`flex h-full ${className}`}>
      {/* Sidebar - Room List */}
      <div className="w-48 border-r shrink-0 flex flex-col bg-muted/20">
        <div className="p-3 border-b">
          <h2 className="text-sm font-medium">聊天</h2>
        </div>
        <ScrollArea className="flex-1 p-2">
          <div className="space-y-1">
            {roomList.map(room => (
              <RoomItem
                key={room.roomId}
                room={room}
                isSelected={room.roomId === selectedId}
                onClick={() => handleSelectRoom(room.roomId)}
              />
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 min-w-0">
        <ChatRoom
          roomId={selectedId}
          roomName={selectedRoom.name}
          topic={selectedRoom.topic}
          canSend={canSend}
          onSendMessage={handleSendMessage}
          className="h-full"
        />
      </div>
    </div>
  );
}

