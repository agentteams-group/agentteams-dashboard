'use client';

import { useCallback, useMemo, useState } from 'react';
import { ChatMessage, ChatSender } from '@tdesign-react/chat';
import '@tdesign-react/chat/es/style/index.js';
import { MessageSquareText } from 'lucide-react';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useTeams } from '@/hooks/use-agentteams-teams';
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useMatrixRoomMessages, useMatrixSendMessage, formatMatrixEvents } from '@/hooks/use-matrix';
import { useMatrixStore } from '@/lib/matrix-store';
import type { MatrixEvent } from '@/lib/matrix-api';
import { buildRooms } from '../chat/room-builders';
import { ChatRoomSidebar } from '../chat/chat-room-sidebar';
import { ChatAuthBadge } from '../chat/chat-auth-badge';
import { MatrixStatusBanner } from '../chat/matrix-status-banner';
import { ChatEmptyState } from '../chat/chat-empty-state';
import { toTDesignMatrixMessage } from './matrix-message';

export function ChatV2Section() {
  const { data: workers, isLoading: workersLoading } = useWorkers();
  const { data: teams, isLoading: teamsLoading } = useTeams();
  const { data: managers, isLoading: managersLoading } = useManagers();
  const { isLoggedIn, userId, logout } = useMatrixStore();
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [input, setInput] = useState('');
  const sendMutation = useMatrixSendMessage();

  const rooms = useMemo(() => buildRooms(workers, teams, managers), [workers, teams, managers]);
  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === selectedRoomId) || null,
    [rooms, selectedRoomId],
  );
  const messagesQuery = useMatrixRoomMessages(selectedRoomId);
  const messages = useMemo(() => {
    const events = messagesQuery.data?.pages.flatMap((page) => page.chunk || []) || [];
    return formatMatrixEvents(events as MatrixEvent[], userId || '');
  }, [messagesQuery.data, userId]);

  const handleSend = useCallback(() => {
    const body = input.trim();
    if (!body || !selectedRoomId || !isLoggedIn) return;
    sendMutation.mutate({ roomId: selectedRoomId, body });
    setInput('');
  }, [input, isLoggedIn, selectedRoomId, sendMutation]);

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] min-h-0 overflow-hidden">
      <div className="shrink-0 px-3 py-1.5 border-b border-border flex items-center justify-between bg-card/30">
        <div className="flex items-center gap-2">
          <MessageSquareText className="w-4 h-4 text-blue-500" />
          <h2 className="text-sm font-semibold">Matrix 聊天 2</h2>
          <span className="text-[10px] text-muted-foreground hidden sm:inline">TDesign Chat 界面</span>
        </div>
        <ChatAuthBadge
          isLoggedIn={isLoggedIn}
          userId={userId}
          onLogout={logout}
          onLoginClick={() => setShowLoginDialog(true)}
          showLoginDialog={showLoginDialog}
          onLoginDialogChange={setShowLoginDialog}
        />
      </div>

      {!isLoggedIn && <MatrixStatusBanner isLoggedIn={isLoggedIn} onLoginClick={() => setShowLoginDialog(true)} />}

      <div className="flex-1 flex min-h-0">
        <ChatRoomSidebar
          rooms={rooms}
          selectedRoomId={selectedRoomId}
          onSelectRoom={setSelectedRoomId}
          isLoggedIn={isLoggedIn}
          userId={userId}
          isLoading={workersLoading || teamsLoading || managersLoading}
        />
        <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-background">
          {selectedRoom ? (
            <>
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-sm font-medium">{selectedRoom.name}</h3>
                {selectedRoom.parentTeam && <p className="text-xs text-muted-foreground">团队：{selectedRoom.parentTeam}</p>}
              </div>
              <div className="flex-1 overflow-y-auto px-3 py-4 space-y-4 custom-scrollbar">
                {messages.map((message) => {
                  const adapted = toTDesignMatrixMessage(message);
                  return (
                    <ChatMessage
                      key={message.id}
                      id={adapted.id}
                      name={message.senderShort}
                      role={adapted.role}
                      datetime={adapted.datetime}
                      status={adapted.status}
                      content={adapted.content}
                      actions={false}
                      placement={message.isMe ? 'right' : 'left'}
                    />
                  );
                })}
              </div>
              <div className="shrink-0 border-t border-border p-3">
                <ChatSender
                  value={input}
                  placeholder={`发送消息到 ${selectedRoom.name}`}
                  disabled={!isLoggedIn}
                  loading={sendMutation.isPending}
                  onChange={(event) => setInput(event.detail)}
                  onSend={handleSend}
                  actions={['send']}
                />
              </div>
            </>
          ) : (
            <ChatEmptyState isLoggedIn={isLoggedIn} onLoginClick={() => setShowLoginDialog(true)} />
          )}
        </main>
      </div>
    </div>
  );
}
