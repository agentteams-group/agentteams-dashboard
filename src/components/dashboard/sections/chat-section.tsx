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
    <div className="space-y-0 h-[calc(100vh-10rem)] flex flex-col">
      <div className="shrink-0 mb-3">
        <SectionHeader
          title="Matrix 聊天"
          description="实时通信与人机协同"
          isLive={isConnected}
          onRefresh={handleRefresh}
          actions={
            <ChatAuthBadge
              isLoggedIn={isLoggedIn}
              userId={userId}
              onLogout={logout}
              onLoginClick={() => setShowLoginDialog(true)}
              showLoginDialog={showLoginDialog}
              onLoginDialogChange={setShowLoginDialog}
            />
          }
        />
      </div>

      <MatrixStatusBanner isLoggedIn={isLoggedIn} onLoginClick={() => setShowLoginDialog(true)} />

      <div className="flex-1 flex gap-3 min-h-0 mt-3">
        <ChatRoomSidebar
          rooms={rooms}
          selectedRoomId={selectedRoomId}
          onSelectRoom={setSelectedRoomId}
          isLoggedIn={isLoggedIn}
          userId={userId}
          isLoading={isLoading}
        />

        <div className="flex-1 border border-border rounded-xl bg-card/30 backdrop-blur-sm overflow-hidden flex flex-col min-w-0">
          {selectedRoom ? (
            <ChatPanel room={selectedRoom} />
          ) : (
            <ChatEmptyState
              isLoggedIn={isLoggedIn}
              onLoginClick={() => setShowLoginDialog(true)}
            />
          )}
        </div>

        <div className="w-60 shrink-0 space-y-4 overflow-y-auto custom-scrollbar hidden xl:block">
          <RoomTopology rooms={rooms} />
          <HumanPanel />
        </div>
      </div>
    </div>
  );
}
