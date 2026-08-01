'use client';

import { useCallback, useMemo, useState } from 'react';
import { useChatStore } from './ChatStore';
import { MessageList } from './structures/MessageList';
import { useMatrixStore } from '@/lib/matrix-store';
import {
  useMatrixRoomMessages,
  useMatrixRoomMembers,
  useMatrixRoomState,
  useMatrixSendMessage,
  formatMatrixEvents,
  type DisplayMessage,
  type RoomMember,
} from '@/hooks/use-matrix';
import type { MatrixEvent } from '@/lib/matrix-api';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

interface ChatRoomProps {
  roomId: string;
  roomName: string;
  topic?: string;
  avatar?: string;
  members?: RoomMember[];
  canSend?: boolean;
  onSendMessage?: (_content: string, _options?: { html?: boolean }) => void;
  className?: string;
}

export function ChatRoom({
  roomId,
  roomName,
  topic,
  avatar,
  members: initialMembers = [],
  canSend = true,
  onSendMessage,
  className = '',
}: ChatRoomProps) {
  const { setAutoScroll } = useChatStore();
  const [autoScroll, setAutoScrollLocal] = useState(true);
  const [newMessagesCount, setNewMessagesCount] = useState(0);

  const { userId, isLoggedIn } = useMatrixStore();
  const sendMutation = useMatrixSendMessage();

  const messagesQuery = useMatrixRoomMessages(roomId);
  const membersQuery = useMatrixRoomMembers(roomId);
  const stateQuery = useMatrixRoomState(roomId);

  const currentUserId = userId;

  // Derive all events and formatted messages
  const allEvents = useMemo<MatrixEvent[]>(() => {
    if (!messagesQuery.isSuccess || !messagesQuery.data) return [];
    const events: MatrixEvent[] = [];
    for (const page of messagesQuery.data.pages) {
      if (page.chunk) events.push(...page.chunk);
    }
    return events;
  }, [messagesQuery.data, messagesQuery.isSuccess]);

  const formattedMessages = useMemo<DisplayMessage[]>(() => {
    return formatMatrixEvents(allEvents, currentUserId);
  }, [allEvents, currentUserId]);

  // Display messages derived from formatted messages
  const displayMessages = formattedMessages;

  // Load more handler
  const loadMore = useCallback(async () => {
    if (!messagesQuery.hasNextPage || messagesQuery.isFetchingNextPage) return;
    await messagesQuery.fetchNextPage();
  }, [messagesQuery]);

  // Send handler
  const handleSend = useCallback((_content: string, _options?: { html?: boolean }) => {
    if (onSendMessage) {
      onSendMessage(_content, _options);
      return;
    }
    if (!roomId || !isLoggedIn) return;
    sendMutation.mutate({
      roomId,
      body: _content,
      formattedBody: _options?.html ? _content : undefined,
    });
  }, [roomId, isLoggedIn, sendMutation, onSendMessage]);

  const handleJumpToNew = useCallback(() => {
    setNewMessagesCount(0);
    setAutoScroll(true);
  }, [setAutoScroll]);

  const handleAutoScrollChange = useCallback((auto: boolean) => {
    setAutoScrollLocal(auto);
    setAutoScroll(auto);
  }, [setAutoScroll]);

  // Derive room members
  const roomMembers = useMemo<RoomMember[]>(() => {
    if (membersQuery.data?.chunk) {
      return membersQuery.data.chunk.map((e: MatrixEvent) => ({
        userId: e.sender,
        displayName: String(e.content.displayname || e.sender),
        membership: e.content.membership || 'join',
      }));
    }
    if (stateQuery.data) {
      return stateQuery.data
        .filter(e => e.type === 'm.room.member' && e.content.membership === 'join')
        .map(e => ({
          userId: e.sender || '',
          displayName: String(e.content.displayname || e.sender || ''),
          membership: 'join',
        }));
    }
    return initialMembers;
  }, [membersQuery.data, stateQuery.data, initialMembers]);

  const header = useMemo(() => (
    <div className="flex items-center gap-3 px-4 py-3 border-b bg-card">
      {avatar ? (
        <Avatar className="w-8 h-8 shrink-0">
          <img src={avatar} alt={roomName} />
        </Avatar>
      ) : (
        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
          <span className="text-xs font-medium">{roomName.charAt(0).toUpperCase()}</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-sm truncate">{roomName}</h3>
        {topic && (
          <p className="text-xs text-muted-foreground truncate">{topic}</p>
        )}
      </div>
      {roomMembers.length > 0 && (
        <Badge variant="secondary" className="text-xs">
          {roomMembers.length} 在线
        </Badge>
      )}
    </div>
  ), [roomName, topic, avatar, roomMembers.length]);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {header}
      <div className="flex-1 overflow-hidden">
        <MessageList
          messages={displayMessages}
          hasNextPage={messagesQuery.hasNextPage || false}
          isFetchingNextPage={messagesQuery.isFetchingNextPage}
          onLoadMore={loadMore}
          _autoScroll={autoScroll}
          _onAutoScrollChange={handleAutoScrollChange}
          _newMessagesCount={newMessagesCount}
          _onJumpToNew={handleJumpToNew}
          loading={false}
          canSend={canSend && isLoggedIn}
          onSend={handleSend}
          className="h-full"
        />
      </div>
    </div>
  );
}
