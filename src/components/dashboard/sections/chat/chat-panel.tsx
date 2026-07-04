'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDown,
  ExternalLink,
  Hash,
  MessageSquare,
  RefreshCw,
  Users,
  Lock,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  useMatrixRoomMessages,
  useMatrixRoomMembers,
  useMatrixRoomState,
  useMatrixSendMessage,
  formatMatrixEvent,
  getRoomNameFromState,
  getRoomTopicFromState,
  type DisplayMessage,
} from '@/hooks/use-matrix';
import { useMatrixStore } from '@/lib/matrix-store';
import type { RoomInfo } from './room-info';
import { formatDate, getAvatarColor, isDifferentDay } from './format';
import { MessageBubble } from './message-bubble';
import { DateSeparator } from './date-separator';
import { ChatComposer } from './chat-composer';

type DisplayItem =
  | { type: 'date'; date: string; key: string }
  | { type: 'message'; message: DisplayMessage; showSender: boolean; key: string };

function buildDisplayItems(messages: DisplayMessage[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  messages.forEach((msg, i) => {
    const prev = i > 0 ? messages[i - 1] : null;
    const showDateSeparator = !prev || isDifferentDay(msg.timestamp, prev.timestamp);
    const showSender =
      !prev ||
      prev.sender !== msg.sender ||
      prev.timestamp - msg.timestamp > 300000 ||
      showDateSeparator;

    if (showDateSeparator) {
      items.push({ type: 'date', date: formatDate(msg.timestamp), key: `date-${msg.timestamp}` });
    }
    items.push({ type: 'message', message: msg, showSender, key: msg.id });
  });
  return items;
}

function MembersSidebar({
  open,
  onClose,
  members,
  isLoading,
}: {
  open: boolean;
  onClose: () => void;
  members: Array<{ userId: string; displayName: string }>;
  isLoading: boolean;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 240, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="border-l border-border overflow-hidden shrink-0"
        >
          <div className="w-[240px] h-full flex flex-col">
            <div className="px-3 py-2.5 border-b border-border flex items-center justify-between">
              <h4 className="font-semibold text-xs">房间成员 ({members.length})</h4>
              <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={onClose}>
                <ArrowDown className="w-3 h-3" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5 custom-scrollbar">
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full rounded" />
                ))
              ) : (
                members.map((member) => {
                  const color = getAvatarColor(member.userId);
                  return (
                    <div
                      key={member.userId}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent"
                    >
                      <Avatar className="w-6 h-6">
                        <AvatarFallback className={`text-[8px] ${color}`}>
                          {member.displayName.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{member.displayName}</p>
                        <p className="text-[9px] text-muted-foreground font-mono truncate">
                          {member.userId}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ChatLoginRequired() {
  return (
    <div className="flex items-center justify-center h-full text-center p-8">
      <div>
        <Lock className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
        <h3 className="font-semibold mb-2">需要登录 Matrix</h3>
        <p className="text-sm text-muted-foreground">请先登录 Matrix 账号以查看和发送消息</p>
      </div>
    </div>
  );
}

function ChatMessages({
  isLoading,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  items,
  autoScroll,
  onJumpToLatest,
}: {
  isLoading: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  items: DisplayItem[];
  autoScroll: boolean;
  onJumpToLatest: () => void;
}) {
  return (
    <>
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-2">
              <Skeleton className="w-7 h-7 rounded-full shrink-0" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-10 w-3/4 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center justify-center h-full text-center">
          <div>
            <MessageSquare className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">暂无消息</p>
            <p className="text-xs text-muted-foreground mt-1">发送第一条消息开始对话</p>
          </div>
        </div>
      ) : (
        <>
          {hasNextPage && (
            <div className="flex justify-center mb-4">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={onLoadMore}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? (
                  <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <ArrowDown className="w-3 h-3 mr-1" />
                )}
                加载更早消息
              </Button>
            </div>
          )}
          {items.map((item) =>
            item.type === 'date' ? (
              <DateSeparator key={item.key} date={item.date} />
            ) : (
              <MessageBubble key={item.key} message={item.message} showSender={item.showSender} />
            )
          )}
        </>
      )}
      {!autoScroll && items.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="sticky bottom-2 flex justify-center"
        >
          <Button
            variant="secondary"
            size="sm"
            className="text-xs rounded-full shadow-lg"
            onClick={onJumpToLatest}
          >
            <ArrowDown className="w-3 h-3 mr-1" />
            回到最新
          </Button>
        </motion.div>
      )}
    </>
  );
}

function ChatHeader({
  roomName,
  roomTopic,
  memberCount,
  onToggleMembers,
  showMembers,
  roomId,
}: {
  roomName: string;
  roomTopic: string | null;
  memberCount: number;
  onToggleMembers: () => void;
  showMembers: boolean;
  roomId: string;
}) {
  return (
    <div className="border-b border-border px-4 py-2.5 flex items-center justify-between shrink-0 bg-card/30">
      <div className="flex items-center gap-2 min-w-0">
        <Hash className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <h3 className="font-semibold text-sm truncate">{roomName}</h3>
          {roomTopic && <p className="text-[10px] text-muted-foreground truncate">{roomTopic}</p>}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Badge variant="outline" className="text-[10px]">
          {memberCount} 成员
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={onToggleMembers}
          title={showMembers ? '隐藏成员列表' : '显示成员列表'}
          aria-label={showMembers ? '隐藏成员列表' : '显示成员列表'}
        >
          <Users className="w-4 h-4" />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 text-[10px]" asChild>
          <a
            href={`https://app.element.io/#/room/${roomId}`}
            target="_blank"
            rel="noopener noreferrer"
            title="在 Element Web 中打开"
          >
            <ExternalLink className="w-3 h-3 mr-1" />
            Element
          </a>
        </Button>
      </div>
    </div>
  );
}

export function ChatPanel({ room }: { room: RoomInfo }) {
  const { userId, isLoggedIn } = useMatrixStore();
  const messagesQuery = useMatrixRoomMessages(room.id);
  const membersQuery = useMatrixRoomMembers(room.id);
  const stateQuery = useMatrixRoomState(room.id);
  const sendMessage = useMatrixSendMessage();
  const [inputValue, setInputValue] = useState('');
  const [showMembers, setShowMembers] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const allMessages = useMemo(() => {
    const pages = messagesQuery.data?.pages || [];
    const events = pages.flatMap((page) => page.chunk || []);
    return [...events]
      .reverse()
      .map((e) => formatMatrixEvent(e, userId))
      .filter((m): m is DisplayMessage => m !== null);
  }, [messagesQuery.data, userId]);

  const displayItems = useMemo(() => buildDisplayItems(allMessages), [allMessages]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
  }, [displayItems, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 100);
  }, []);

  const handleSend = useCallback(() => {
    if (!inputValue.trim() || sendMessage.isPending) return;
    sendMessage.mutate(
      { roomId: room.id, body: inputValue.trim() },
      { onSuccess: () => setInputValue('') }
    );
  }, [inputValue, room.id, sendMessage]);

  const memberList = useMemo(() => {
    const members = membersQuery.data?.chunk || [];
    return members
      .filter((e) => e.type === 'm.room.member' && e.content?.membership === 'join')
      .map((e) => ({
        userId: e.state_key || '',
        displayName:
          e.content?.displayname || e.state_key?.split(':')[0]?.slice(1) || '',
        avatarUrl: e.content?.avatar_url,
      }));
  }, [membersQuery.data]);

  const roomName = useMemo(() => {
    const stateEvents = stateQuery.data || [];
    return getRoomNameFromState(stateEvents) || room.name;
  }, [stateQuery.data, room.name]);

  const roomTopic = useMemo(() => {
    const stateEvents = stateQuery.data || [];
    return getRoomTopicFromState(stateEvents);
  }, [stateQuery.data]);

  if (!isLoggedIn) {
    return <ChatLoginRequired />;
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col min-w-0">
        <ChatHeader
          roomName={roomName}
          roomTopic={roomTopic}
          memberCount={memberList.length}
          onToggleMembers={() => setShowMembers((v) => !v)}
          showMembers={showMembers}
          roomId={room.id}
        />
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 custom-scrollbar"
        >
          <ChatMessages
            isLoading={messagesQuery.isLoading}
            hasNextPage={!!messagesQuery.hasNextPage}
            isFetchingNextPage={!!messagesQuery.isFetchingNextPage}
            onLoadMore={() => messagesQuery.fetchNextPage()}
            items={displayItems}
            autoScroll={autoScroll}
            onJumpToLatest={() => {
              if (scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                setAutoScroll(true);
              }
            }}
          />
        </div>
        <ChatComposer
          value={inputValue}
          onChange={setInputValue}
          onSend={handleSend}
          isSending={sendMessage.isPending}
          sendError={sendMessage.isError ? sendMessage.error?.message ?? null : null}
          placeholder={`发送消息到 ${roomName}... (Enter 发送, Shift+Enter 换行)`}
          disabled={false}
        />
      </div>
      <MembersSidebar
        open={showMembers}
        onClose={() => setShowMembers(false)}
        members={memberList}
        isLoading={membersQuery.isLoading}
      />
    </div>
  );
}
