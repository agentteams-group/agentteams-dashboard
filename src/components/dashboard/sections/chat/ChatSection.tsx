'use client';

import { useState, useMemo } from 'react';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useTeams } from '@/hooks/use-agentteams-teams';
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useHumans } from '@/hooks/use-agentteams-humans';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useMatrixStore } from '@/lib/matrix-store';
import {
  useMatrixRoomMembers,
  useMatrixRoomState,
  type RoomMember,
} from '@/hooks/use-matrix';
import type { MatrixEvent } from '@/lib/matrix-api';
import { ApiErrorState } from '@/components/dashboard/api-error-state';
import { MessageSquare, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buildRooms } from './room-builders';
import { ChatAuthBadge } from './chat-auth-badge';
import { ChatRoomSidebar } from './chat-room-sidebar';
import { ChatEmptyState } from './chat-empty-state';
import { ChatPanel } from './ChatPanel';
import { HumanPanel } from './human-panel';
import { RoomTopology } from './room-topology';
import { MatrixStatusBanner } from './matrix-status-banner';
import { ChatProvider } from './ChatStore';

export function ChatSection() {
  const { data: workers, isLoading: workersLoading } = useWorkers();
  const { data: teams, isLoading: teamsLoading } = useTeams();
  const { data: managers, isLoading: managersLoading } = useManagers();
  const { isLoading: humansLoading } = useHumans();
  const { isConnected } = useAgentTeamsStore();
  const { isLoggedIn, userId, logout } = useMatrixStore();

  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(false);

  const isLoading = workersLoading || teamsLoading || managersLoading || humansLoading;
  const hasError = !isConnected;

  const rooms = useMemo(() => buildRooms(workers, teams, managers), [workers, teams, managers]);
  const selectedRoom = useMemo(
    () => rooms.find((r) => r.id === selectedRoomId) || null,
    [rooms, selectedRoomId],
  );

  // Fetch room members for topology display
  const membersQuery = useMatrixRoomMembers(selectedRoomId);
  const stateQuery = useMatrixRoomState(selectedRoomId);
  const roomMembers: RoomMember[] = useMemo(() => {
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
    return selectedRoom?.members?.map(m => ({ userId: m, displayName: m.split(':')[0].slice(1), membership: 'join' })) || [];
  }, [membersQuery.data, stateQuery.data, selectedRoom]);

  if (hasError) {
    return <ApiErrorState />;
  }

  return (
    <ChatProvider>
      <div className="flex flex-col h-[calc(100vh-3rem)] min-h-0 overflow-hidden">
        {/* Compact header bar */}
        <div className="shrink-0 px-4 py-2.5 border-b border-border flex items-center justify-between bg-card/40">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-sm">
              <MessageSquare className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="leading-tight">
              <h2 className="text-sm font-semibold">Agent Chat</h2>
              <span className="text-[10px] text-muted-foreground hidden sm:inline">实时通信与人机协同</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setShowRightPanel((v) => !v)}
              title={showRightPanel ? '隐藏侧栏' : '显示侧栏'}
            >
              {showRightPanel ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
            </Button>
            <ChatAuthBadge
              isLoggedIn={isLoggedIn}
              userId={userId}
              onLogout={logout}
              onLoginClick={() => setShowLoginDialog(true)}
              showLoginDialog={showLoginDialog}
              onLoginDialogChange={setShowLoginDialog}
            />
          </div>
        </div>

        {/* Login banner */}
        {!isLoggedIn && (
          <MatrixStatusBanner isLoggedIn={isLoggedIn} onLoginClick={() => setShowLoginDialog(true)} />
        )}

        {/* Main content: 2 or 3 column flex */}
        <div className="flex-1 flex min-h-0">
          {/* Left: Room list */}
          <ChatRoomSidebar
            rooms={rooms}
            selectedRoomId={selectedRoomId}
            onSelectRoom={setSelectedRoomId}
            isLoggedIn={isLoggedIn}
            userId={userId}
            isLoading={isLoading}
          />

          {/* Center: Chat panel */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {selectedRoom ? (
              // key forces a fresh ChatRoom instance per room so input,
              // in-flight local messages and scroll state never leak across
              // rooms when switching conversations.
              <ChatPanel key={selectedRoom.id} room={selectedRoom} />
            ) : (
              <ChatEmptyState
                isLoggedIn={isLoggedIn}
                onLoginClick={() => setShowLoginDialog(true)}
              />
            )}
          </div>

          {/* Right: Members + Topology (toggleable) */}
          {showRightPanel && (
            <div className="w-48 shrink-0 flex flex-col border-l border-border overflow-hidden">
              <div className="flex-1 overflow-y-auto p-2 space-y-3 custom-scrollbar">
                <RoomTopology rooms={rooms} selectedRoomId={selectedRoomId} members={roomMembers} />
                <HumanPanel />
              </div>
            </div>
          )}
        </div>
      </div>
    </ChatProvider>
  );
}
