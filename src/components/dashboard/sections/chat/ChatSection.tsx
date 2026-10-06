'use client';

import { useState, useMemo, useCallback, useEffect, useSyncExternalStore } from 'react';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useTeams } from '@/hooks/use-agentteams-teams';
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useHumans } from '@/hooks/use-agentteams-humans';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useMatrixStore } from '@/lib/matrix-store';
import {
  useMatrixRoomMembers,
  useMatrixRoomState,
  useRoomMetaStore,
  type RoomMember,
} from '@/hooks/use-matrix';
import type { MatrixEvent } from '@/lib/matrix-api';
import { ApiErrorState } from '@/components/dashboard/api-error-state';
import { AlertTriangle, MessageSquare, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-error';
import { buildRooms, sortRoomsByRecency, type RoomMetaByRoomId } from './room-builders';
import { ChatAuthBadge } from './chat-auth-badge';
import { SyncStatusChip } from './sync-status-chip';
import { ChatRoomSidebar } from './chat-room-sidebar';
import { ChatEmptyState } from './chat-empty-state';
import { ChatPanel } from './ChatPanel';
import { HumanPanel } from './human-panel';
import { RoomTopology } from './room-topology';
import { MatrixStatusBanner } from './matrix-status-banner';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { ChatProvider } from './ChatStore';
import { RuntimeMapProvider, type RuntimeMap } from './runtime-map-context';

const NARROW_MQ = '(max-width: 767px)';

function subscribeNarrowViewport(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(NARROW_MQ);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function getNarrowViewport(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(NARROW_MQ).matches;
}

function projectionHint(label: string, err: unknown): string {
  const status = err instanceof ApiError ? err.status : undefined;
  if (status === 403 || status === 401) {
    return `${label} 投影失败（${status}）：当前账号无权查看，相关房间不会出现在侧栏。请用管理员身份重登。`;
  }
  if (status === 502) {
    return `${label} 投影失败（502）：Controller 不可达，相关房间暂未加载。`;
  }
  const detail = err instanceof Error ? err.message : '未知错误';
  return `${label} 投影失败：${detail}`;
}

export function ChatSection() {
  const {
    data: workers,
    isLoading: workersLoading,
    isError: workersIsError,
    error: workersError,
    refetch: refetchWorkers,
  } = useWorkers();
  const {
    data: teams,
    isLoading: teamsLoading,
    isError: teamsIsError,
    error: teamsError,
    refetch: refetchTeams,
  } = useTeams();
  const {
    data: managers,
    isLoading: managersLoading,
    isError: managersIsError,
    error: managersError,
    refetch: refetchManagers,
  } = useManagers();
  const {
    data: humans,
    isLoading: humansLoading,
    isError: humansIsError,
    error: humansError,
    refetch: refetchHumans,
  } = useHumans();
  const { isConnected } = useAgentTeamsStore();
  const { isLoggedIn, userId, logout } = useMatrixStore();

  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [isRoomListCollapsed, setIsRoomListCollapsed] = useState(false);

  // A11Y-03: on narrow viewports (< md) the resizable room list (≥176px)
  // would squeeze the message area to near-zero — force it collapsed there
  // (the expand rail stays hidden while narrow). useSyncExternalStore keeps
  // SSR/hydration consistent without a setState-in-effect cascade.
  const narrowViewport = useSyncExternalStore(subscribeNarrowViewport, getNarrowViewport, () => false);

  // Publish the open room to the global sync loop (via the room-meta store)
  // so it merges live timeline events into that room's message cache. Written
  // on every selection change; cleared when the room list is empty.
  const handleSelectRoom = useCallback((roomId: string) => {
    useRoomMetaStore.getState().setActiveRoomId(roomId);
    setSelectedRoomId(roomId);
  }, []);

  const isLoading = workersLoading || teamsLoading || managersLoading || humansLoading;
  const hasError = !isConnected;

  // MXID → owning worker lookup. Every chat bubble from a worker gets its
  // runtime stamped from this map (thinking/tool cards carry runtime badges).
  const runtimeMap = useMemo<RuntimeMap>(() => {
    const map: RuntimeMap = {};
    for (const worker of workers ?? []) {
      if (worker.matrixUserID) {
        map[worker.matrixUserID] = { runtime: worker.runtime, workerName: worker.name };
      }
    }
    return map;
  }, [workers]);

  // Per-room meta (lastMessageTs + unread counts) feeds the sidebar sort and
  // badge. We don't re-sort on every keystroke — just pass the meta to
  // buildRooms and sort at the boundary.
  const roomMeta = useRoomMetaStore((s) => s.meta);
  const rooms = useMemo(
    () => sortRoomsByRecency(buildRooms(workers, teams, managers, roomMeta as RoomMetaByRoomId, humans)),
    [workers, teams, managers, humans, roomMeta],
  );

  const projectionNotices = useMemo(() => {
    const notices: { key: string; message: string; retry: () => void }[] = [];
    if (workersIsError) {
      notices.push({
        key: 'workers',
        message: projectionHint('Workers', workersError),
        retry: () => {
          void refetchWorkers();
        },
      });
    }
    if (teamsIsError) {
      notices.push({
        key: 'teams',
        message: projectionHint('Teams', teamsError),
        retry: () => {
          void refetchTeams();
        },
      });
    }
    if (managersIsError) {
      notices.push({
        key: 'managers',
        message: projectionHint('Managers', managersError),
        retry: () => {
          void refetchManagers();
        },
      });
    }
    if (humansIsError) {
      notices.push({
        key: 'humans',
        message: projectionHint('Humans', humansError),
        retry: () => {
          void refetchHumans();
        },
      });
    }
    return notices;
  }, [
    workersIsError,
    workersError,
    refetchWorkers,
    teamsIsError,
    teamsError,
    refetchTeams,
    managersIsError,
    managersError,
    refetchManagers,
    humansIsError,
    humansError,
    refetchHumans,
  ]);

  // Deep-link consumption: read the pending value WITHOUT clearing it, and
  // only take (clear) it once the room list is loaded and actually contains
  // the target room. FUNC-04: clearing unconditionally during render dropped
  // the deep link whenever the rooms list was still loading.
  if (!isLoading) {
    const pendingChatRoomId = useHitlInboxStore.getState().pendingChatRoomId;
    if (pendingChatRoomId && rooms.some((r) => r.id === pendingChatRoomId)) {
      useHitlInboxStore.getState().takePendingChatRoomId();
      setSelectedRoomId(pendingChatRoomId);
      useRoomMetaStore.getState().setActiveRoomId(pendingChatRoomId);
    }
  }

  useEffect(() => {
    if (selectedRoomId === null || !rooms.some((r) => r.id === selectedRoomId)) {
      useRoomMetaStore.getState().setActiveRoomId(null);
    }
  }, [selectedRoomId, rooms]);
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
      <RuntimeMapProvider map={runtimeMap}>
      <div className="flex flex-col h-[calc(100vh-3rem)] min-h-0 overflow-hidden">
        {/* Compact header bar */}
        <div className="shrink-0 px-4 py-2.5 border-b border-border flex items-center justify-between bg-card/40">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-sm">
              <MessageSquare className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <div className="leading-tight">
              <h2 className="text-sm font-semibold">Agent Chat</h2>
              <span className="text-[10px] text-muted-foreground hidden sm:inline">实时通信与人机协同</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <SyncStatusChip />
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

        {projectionNotices.map((notice) => (
          <div
            key={notice.key}
            className="shrink-0 mx-4 mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300"
            role="status"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <p className="flex-1">{notice.message}</p>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={notice.retry}>
              重试
            </Button>
          </div>
        ))}

        {/* Login banner */}
        {!isLoggedIn && (
          <MatrixStatusBanner isLoggedIn={isLoggedIn} onLoginClick={() => setShowLoginDialog(true)} />
        )}

        {/* Main content: 2 or 3 column flex */}
        <div className="flex-1 flex min-h-0">
          {/* Left: Room list */}
          {(isRoomListCollapsed || narrowViewport) && (
            <div className="w-10 shrink-0 border-r border-border bg-muted/20 pt-2">
              <Button
                variant="ghost"
                size="sm"
                className="mx-auto h-7 w-7 p-0 max-md:hidden"
                onClick={() => setIsRoomListCollapsed(false)}
                title="显示会话列表"
              >
                <PanelLeftOpen className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
          {!isRoomListCollapsed && !narrowViewport && (
            <ChatRoomSidebar
              rooms={rooms}
              selectedRoomId={selectedRoomId}
              onSelectRoom={handleSelectRoom}
              isLoggedIn={isLoggedIn}
              userId={userId}
              isLoading={isLoading}
              onCollapse={() => setIsRoomListCollapsed(true)}
            />

          )}

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

          {/* Right: Members + Topology (toggleable); overlays on mobile */}
          {showRightPanel && (
            <div className="w-48 shrink-0 flex flex-col border-l border-border overflow-hidden
              max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-30 max-md:shadow-xl max-md:bg-card">
              <div className="flex-1 overflow-y-auto p-2 space-y-3 custom-scrollbar">
                <RoomTopology rooms={rooms} selectedRoomId={selectedRoomId} members={roomMembers} />
                <HumanPanel />
              </div>
            </div>
          )}
        </div>
      </div>
      </RuntimeMapProvider>
    </ChatProvider>
  );
}
