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
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  useMatrixRoomMessages,
  useMatrixRoomMembers,
  useMatrixRoomState,
  useMatrixSendMessage,
  useMatrixUploadMedia,
  useMatrixSendTyping,
  useMatrixTypingUsers,
  useTypingSync,
  formatMatrixEvent,
  getRoomNameFromState,
  getRoomTopicFromState,
  type DisplayMessage,
} from '@/hooks/use-matrix';
import { TypingIndicator } from './typing-indicator';
import { useMatrixStore } from '@/lib/matrix-store';
import type { RoomInfo } from './room-info';
import { formatDate, getAvatarColor, isDifferentDay } from './format';
import { MessageBubble } from './message-bubble';
import { DateSeparator } from './date-separator';
import { ChatComposer, type MentionEntry } from './chat-composer';

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
    <div className="border-b border-border px-4 py-2 flex items-center justify-between shrink-0 bg-card/20">
      <div className="flex items-center gap-2 min-w-0">
        <Hash className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <h3 className="font-medium text-sm truncate">{roomName}</h3>
        {roomTopic && <span className="text-xs text-muted-foreground truncate hidden lg:inline">— {roomTopic}</span>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-[10px] text-muted-foreground">{memberCount} 成员</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
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
  const uploadMedia = useMatrixUploadMedia();
  const sendTyping = useMatrixSendTyping();
  const typingUsers = useMatrixTypingUsers(room.id);
  useTypingSync(room.id);
  const [inputValue, setInputValue] = useState('');
  const [showMembers, setShowMembers] = useState(false);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [pendingMessages, setPendingMessages] = useState<DisplayMessage[]>([]);
  const [currentMentions, setCurrentMentions] = useState<MentionEntry[]>([]);

  const allMessages = useMemo(() => {
    const pages = messagesQuery.data?.pages || [];
    const events = pages.flatMap((page) => page.chunk || []);
    const serverMessages = [...events]
      .reverse()
      .map((e) => formatMatrixEvent(e, userId))
      .filter((m): m is DisplayMessage => m !== null);
    // Remove pending messages that now exist on the server
    const pendingIds = new Set(serverMessages.map((m) => m.id));
    const filteredPending = pendingMessages.filter(
      (p) => p.status === 'sending' && !pendingIds.has(p.id)
    );
    return [...filteredPending, ...serverMessages];
  }, [messagesQuery.data, userId, pendingMessages]);

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
    // Stop typing notification
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    sendTyping.mutate({ roomId: room.id, typing: false });
    const body = inputValue.trim();

    // Build Matrix-compliant formatted body with proper mention links
    let formattedBody = body;
    const mentionedUserIds: string[] = [];
    for (const m of currentMentions) {
      // Only include mentions that are still present in the text
      if (body.includes(m.placeholder)) {
        const link = `<a href="https://matrix.to/#/${encodeURIComponent(m.userId)}">${m.displayName}</a>`;
        formattedBody = formattedBody.replaceAll(m.placeholder, link);
        if (!mentionedUserIds.includes(m.userId)) {
          mentionedUserIds.push(m.userId);
        }
      }
    }
    // Apply markdown formatting (after mention link replacement)
    formattedBody = formattedBody
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/\n/g, '<br />');

    // Build m.mentions field per Matrix spec (MSC3952)
    const mentions = mentionedUserIds.length > 0 ? { user_ids: mentionedUserIds } : undefined;

    // Optimistic: add a pending message immediately
    const pendingId = `pending-${Date.now()}`;
    const optimisticMsg: DisplayMessage = {
      id: pendingId,
      sender: userId || '',
      senderShort: userId ? userId.split(':')[0].slice(1) : 'me',
      content: body,
      formattedContent: formattedBody,
      timestamp: Date.now(),
      type: 'm.text',
      isMe: true,
      status: 'sending',
    };
    setPendingMessages((prev) => [...prev, optimisticMsg]);
    setInputValue('');
    setCurrentMentions([]);

    sendMessage.mutate(
      { roomId: room.id, body, formattedBody, mentions },
      {
        onSuccess: () => {
          setPendingMessages((prev) =>
            prev.map((p) => (p.id === pendingId ? { ...p, status: 'sent' as const } : p))
          );
          setTimeout(() => {
            setPendingMessages((prev) => prev.filter((p) => p.id !== pendingId));
          }, 2000);
        },
        onError: () => {
          setPendingMessages((prev) =>
            prev.map((p) => (p.id === pendingId ? { ...p, status: 'error' as const } : p))
          );
        },
      }
    );
  }, [inputValue, room.id, sendMessage, userId, sendTyping, currentMentions]);

  // File upload handler
  const handleFileUpload = useCallback(
    async (file: File) => {
      if (!userId) return;
      try {
        const result = await uploadMedia.mutateAsync({ roomId: room.id, file });
        const contentUri = result.content_uri;
        const isImage = file.type.startsWith('image/');
        const msgtype = isImage ? 'm.image' : 'm.file';
        const body = file.name;
        await sendMessage.mutateAsync({
          roomId: room.id,
          body,
          formattedBody: undefined,
          extra: { msgtype, url: contentUri, info: { mimetype: file.type, size: file.size } },
        });
      } catch {
        // Error handled by mutation state
      }
    },
    [room.id, uploadMedia, sendMessage, userId]
  );

  // Slash command handler
  const handleSlashCommand = useCallback(
    (command: string, args: string) => {
      switch (command) {
        case 'help':
          // Show help as a system-like message
          alert('可用指令:\n/help - 显示帮助\n/clear - 清空输入\n/members - 切换成员列表\n/topic <text> - 设置房间主题');
          break;
        case 'members':
          setShowMembers((v) => !v);
          break;
        case 'topic':
          if (args.trim()) {
            // Set room topic via state event
            // This would need a separate API call - for now just show info
            alert(`设置房间主题: ${args} (功能开发中)`);
          }
          break;
      }
    },
    []
  );

  // Typing notification: send on input change, debounce 3s
  const handleInputChange = useCallback(
    (val: string) => {
      setInputValue(val);
      // Send typing notification
      if (val.trim() && userId) {
        sendTyping.mutate({ roomId: room.id, typing: true });
        // Clear previous timeout
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        // Auto-stop typing after 3s of inactivity
        typingTimeoutRef.current = setTimeout(() => {
          sendTyping.mutate({ roomId: room.id, typing: false });
        }, 3000);
      }
    },
    [room.id, sendTyping, userId]
  );

  // Stop typing on send
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, []);

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

  // Show error state if messages query fails
  if (messagesQuery.isError) {
    return (
      <div className="flex items-center justify-center h-full text-center p-8">
        <div>
          <MessageSquare className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="text-sm font-medium text-red-500">加载消息失败</p>
          <p className="text-xs text-muted-foreground mt-1">
            {messagesQuery.error?.message || '无法连接到 Matrix 服务器'}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 text-xs"
            onClick={() => messagesQuery.refetch()}
          >
            <RefreshCw className="w-3 h-3 mr-1" />
            重试
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
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
          className="flex-1 overflow-y-auto px-4 py-2 custom-scrollbar"
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
        <TypingIndicator users={typingUsers} />
        <ChatComposer
          value={inputValue}
          onChange={handleInputChange}
          onSend={handleSend}
          isSending={sendMessage.isPending}
          sendError={sendMessage.isError ? sendMessage.error?.message ?? null : null}
          placeholder={`发送消息到 ${roomName}... (Enter 发送, Shift+Enter 换行)`}
          disabled={false}
          members={memberList}
          onFileUpload={handleFileUpload}
          isUploading={uploadMedia.isPending}
          onSlashCommand={handleSlashCommand}
          onMentionsChange={setCurrentMentions}
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
