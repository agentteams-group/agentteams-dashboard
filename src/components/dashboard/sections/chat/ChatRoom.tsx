'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChatStore } from './ChatStore';
import { MessageList } from './structures/MessageList';
import type { ScrollPanelHandle } from './structures/ScrollPanel';
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Users, PanelRightClose } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatComposer, type MentionEntry } from './chat-composer';
import { TypingIndicator } from './typing-indicator';
import { useMatrixSendTyping, useMatrixTypingUsers } from '@/hooks/use-matrix';

interface ChatRoomProps {
  roomId: string;
  roomName: string;
  topic?: string;
  avatar?: string;
  members?: RoomMember[];
  canSend?: boolean;
  onSendMessage?: (_content: string, _options?: { html?: boolean }, _mentions?: MentionEntry[]) => void;
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
  const [showMembers, setShowMembers] = useState(false);
  const [replyTo, setReplyTo] = useState<DisplayMessage | null>(null);
  const [mentions, setMentions] = useState<MentionEntry[]>([]);

  const { userId, isLoggedIn } = useMatrixStore();
  const sendMutation = useMatrixSendMessage();
  const sendTyping = useMatrixSendTyping();
  const typingUsers = useMatrixTypingUsers(roomId);
  const scrollRef = useRef<ScrollPanelHandle>(null);
  const prevMsgCountRef = useRef(0);

  const messagesQuery = useMatrixRoomMessages(roomId);
  const membersQuery = useMatrixRoomMembers(roomId);
  const stateQuery = useMatrixRoomState(roomId);

  const currentUserId = userId;

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

  const loadMore = useCallback(async () => {
    if (!messagesQuery.hasNextPage || messagesQuery.isFetchingNextPage) return;
    await messagesQuery.fetchNextPage();
  }, [messagesQuery]);

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

  // Auto-scroll when new messages arrive
  useEffect(() => {
    if (autoScroll && formattedMessages.length > prevMsgCountRef.current) {
      scrollRef.current?.scrollToBottom({ smooth: false });
    }
    prevMsgCountRef.current = formattedMessages.length;
  }, [formattedMessages.length, autoScroll]);

  // Watch for new messages while not auto-scrolling
  useEffect(() => {
    if (!autoScroll && formattedMessages.length > prevMsgCountRef.current) {
      setNewMessagesCount(c => c + (formattedMessages.length - prevMsgCountRef.current));
    }
    prevMsgCountRef.current = formattedMessages.length;
  }, [formattedMessages.length, autoScroll]);

  const handleSend = useCallback((content: string, _options?: { html?: boolean }, mentions?: MentionEntry[]) => {
    if (onSendMessage) {
      onSendMessage(content, _options, mentions);
      return;
    }
    if (!roomId || !isLoggedIn) return;

    const mentionUserIds = mentions?.map(m => m.userId) || [];
    const mentionData = mentionUserIds.length > 0
      ? { 'm.mentions': { user_ids: mentionUserIds } }
      : {};

    sendMutation.mutate({
      roomId,
      body: content,
      formattedBody: _options?.html ? content : undefined,
      extra: mentionData,
    });
    setReplyTo(null);
  }, [roomId, isLoggedIn, sendMutation, onSendMessage]);

  const handleInputChange = useCallback((content: string) => {
    if (content.trim() && userId) {
      sendTyping.mutate({ roomId, typing: true });
    }
  }, [roomId, userId, sendTyping]);

  const handleJumpToNew = useCallback(() => {
    setNewMessagesCount(0);
    setAutoScroll(true);
    scrollRef.current?.scrollToBottom({ smooth: true });
  }, [setAutoScroll]);

  const handleAutoScrollChange = useCallback((auto: boolean) => {
    setAutoScrollLocal(auto);
    setAutoScroll(auto);
  }, [setAutoScroll]);

  const handleReply = useCallback((message: DisplayMessage) => {
    setReplyTo(message);
    // Scroll to the replied message
    scrollRef.current?.scrollToIndex(formattedMessages.length - 1);
  }, [formattedMessages.length]);

  const handleCopy = useCallback((message: DisplayMessage) => {
    navigator.clipboard.writeText(message.content);
  }, []);

  const header = useMemo(() => (
    <div className="flex items-center gap-2 px-4 py-3 border-b bg-card">
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
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 shrink-0"
        onClick={() => setShowMembers(v => !v)}
        title={showMembers ? '隐藏成员' : '显示成员'}
      >
        <Badge variant="secondary" className="text-xs cursor-pointer hover:bg-primary/10">
          <Users className="w-3 h-3 mr-1" />
          {roomMembers.length}
        </Badge>
      </Button>
    </div>
  ), [roomName, topic, avatar, roomMembers.length, showMembers]);

  return (
    <div className={`flex h-full ${className}`}>
      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {header}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {replyTo && (
            <div className="flex items-center gap-2 px-4 py-1.5 bg-emerald-500/10 border-b border-emerald-500/20 text-xs text-emerald-700 dark:text-emerald-400 shrink-0">
              <span>回复 {replyTo.senderShort}:</span>
              <span className="truncate flex-1">{replyTo.content.slice(0, 80)}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 shrink-0 text-emerald-600 hover:text-emerald-700"
                onClick={() => setReplyTo(null)}
              >
                <PanelRightClose className="w-3 h-3" />
              </Button>
            </div>
          )}
          <MessageList
            ref={scrollRef}
            messages={formattedMessages}
            hasNextPage={messagesQuery.hasNextPage || false}
            isFetchingNextPage={messagesQuery.isFetchingNextPage}
            onLoadMore={loadMore}
            loading={messagesQuery.isLoading}
            _canSend={canSend && isLoggedIn}
            _onSend={handleSend}
            onReply={handleReply}
            onCopy={handleCopy}
            memberMap={Object.fromEntries(roomMembers.map(m => [m.userId, m.displayName]))}
            className="flex-1 min-h-0"
          />
          <TypingIndicator users={typingUsers} />
          <ChatComposer
            value=""
            onChange={handleInputChange}
            onSend={() => handleSend('', undefined, mentions)}
            isSending={sendMutation.isPending}
            sendError={sendMutation.error?.message ?? null}
            placeholder={replyTo ? `回复 ${replyTo.senderShort}... (Enter 发送)` : `发送消息到 ${roomName}... (Enter 发送, Shift+Enter 换行)`}
            disabled={!canSend || !isLoggedIn}
            members={roomMembers.map(m => ({ userId: m.userId, displayName: m.displayName }))}
            onSlashCommand={(cmd) => {
              if (cmd === 'members') setShowMembers(v => !v);
            }}
            onMentionsChange={setMentions}
          />
        </div>
      </div>

      {/* Members sidebar */}
      {showMembers && (
        <div className="w-52 shrink-0 border-l border-border bg-card overflow-hidden flex flex-col">
          <div className="px-3 py-2.5 border-b border-border shrink-0 flex items-center justify-between">
            <h4 className="font-semibold text-xs">成员 ({roomMembers.length})</h4>
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setShowMembers(false)}>
              <PanelRightClose className="w-3 h-3" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5 custom-scrollbar">
            {roomMembers.map((member) => {
              const color = member.userId.split(':').pop() === 'agentteams.io'
                ? 'text-emerald-600'
                : 'text-muted-foreground';
              return (
                <div
                  key={member.userId}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer"
                  onClick={() => {
                    navigator.clipboard.writeText(member.userId);
                  }}
                  title="点击复制用户ID"
                >
                  <Avatar className="w-6 h-6 shrink-0">
                    <AvatarFallback className={`text-[8px] ${color}`}>
                      {member.displayName.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{member.displayName}</p>
                    <p className="text-[9px] text-muted-foreground font-mono truncate">
                      {member.userId.split(':')[0].slice(1)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
