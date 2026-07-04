'use client';

import { useState, useMemo, useCallback } from 'react';
import { useWorkers } from '@/hooks/use-hiclaw-workers';
import { useTeams } from '@/hooks/use-hiclaw-teams';
import { useManagers } from '@/hooks/use-hiclaw-managers';
import { useHumans } from '@/hooks/use-hiclaw-humans';
import { useHiClawStore } from '@/lib/hiclaw-store';
import { useMatrixStore } from '@/lib/matrix-store';
import { ApiErrorState } from '@/components/dashboard/api-error-state';
import { SectionHeader } from '@/components/dashboard/section-header';
import { buildRooms } from './chat/room-builders';
import { ChatAuthBadge } from './chat/chat-auth-badge';
import { ChatRoomSidebar } from './chat/chat-room-sidebar';
import { ChatEmptyState } from './chat/chat-empty-state';
import { ChatPanel } from './chat/chat-panel';
import { HumanPanel } from './chat/human-panel';
import { RoomTopology } from './chat/room-topology';
import { MatrixStatusBanner } from './chat/matrix-status-banner';

export function ChatSection() {
  const { data: workers, isLoading: workersLoading, refetch: refetchWorkers } = useWorkers();
  const { data: teams, isLoading: teamsLoading, refetch: refetchTeams } = useTeams();
  const { data: managers, isLoading: managersLoading, refetch: refetchManagers } = useManagers();
  const { isLoading: humansLoading, refetch: refetchHumans } = useHumans();
  const { isConnected } = useHiClawStore();
  const { isLoggedIn, userId, logout } = useMatrixStore();

  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [showLoginDialog, setShowLoginDialog] = useState(false);

  const isLoading = workersLoading || teamsLoading || managersLoading || humansLoading;
  const hasError = !isConnected;

  const handleRefresh = useCallback(() => {
    refetchWorkers();
    refetchTeams();
    refetchManagers();
    refetchHumans();
  }, [refetchWorkers, refetchTeams, refetchManagers, refetchHumans]);

  const rooms = useMemo(() => buildRooms(workers, teams, managers), [workers, teams, managers]);
  const selectedRoom = useMemo(
    () => rooms.find((r) => r.id === selectedRoomId) || null,
    [rooms, selectedRoomId],
  );

  if (hasError) {
    return <ApiErrorState />;
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header - compact, no bottom margin */}
      <div className="shrink-0 px-4 py-2 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">Matrix 聊天</h2>
          <span className="text-xs text-muted-foreground">实时通信与人机协同</span>
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

      {/* Login banner - only shows when not logged in */}
      {!isLoggedIn && (
        <MatrixStatusBanner isLoggedIn={isLoggedIn} onLoginClick={() => setShowLoginDialog(true)} />
      )}

      {/* Main content: 3-column flex, fills remaining space */}
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
        <div className="flex-1 flex flex-col min-w-0 border-l border-r border-border">
          {selectedRoom ? (
            <ChatPanel room={selectedRoom} />
          ) : (
            <ChatEmptyState
              isLoggedIn={isLoggedIn}
              onLoginClick={() => setShowLoginDialog(true)}
            />
          )}
        </div>

        {/* Right: Members + Topology (always visible, narrow) */}
        <div className="w-48 shrink-0 flex flex-col border-l border-border overflow-hidden">
          <div className="flex-1 overflow-y-auto p-2 space-y-3">
            <RoomTopology rooms={rooms} />
            <HumanPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
