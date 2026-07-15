'use client';

import { useState, useMemo } from 'react';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useTeams } from '@/hooks/use-agentteams-teams';
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useHumans } from '@/hooks/use-agentteams-humans';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useMatrixStore } from '@/lib/matrix-store';
import { ApiErrorState } from '@/components/dashboard/api-error-state';
import { MessageSquare, PanelRightOpen, PanelRightClose } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buildRooms } from './chat/room-builders';
import { ChatAuthBadge } from './chat/chat-auth-badge';
import { ChatRoomSidebar } from './chat/chat-room-sidebar';
import { ChatEmptyState } from './chat/chat-empty-state';
import { ChatPanel } from './chat/chat-panel';
import { HumanPanel } from './chat/human-panel';
import { RoomTopology } from './chat/room-topology';
import { MatrixStatusBanner } from './chat/matrix-status-banner';

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

  if (hasError) {
    return <ApiErrorState />;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] min-h-0 overflow-hidden">
      {/* Compact header bar */}
      <div className="shrink-0 px-3 py-1.5 border-b border-border flex items-center justify-between bg-card/30">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold">Matrix 聊天</h2>
          <span className="text-[10px] text-muted-foreground hidden sm:inline">实时通信与人机协同</span>
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
            <ChatPanel room={selectedRoom} />
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
              <RoomTopology rooms={rooms} />
              <HumanPanel />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
