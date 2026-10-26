'use client';

import { useState, useMemo, useCallback, useEffect, useSyncExternalStore } from 'react';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useTeams } from '@/hooks/use-agentteams-teams';
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useHumans } from '@/hooks/use-agentteams-humans';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useMatrixStore } from '@/lib/matrix-store';
import { useRoomMetaStore } from '@/hooks/use-matrix';
import { ApiErrorState } from '@/components/dashboard/api-error-state';
import { AlertTriangle, PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-error';
import { buildRooms, sortRoomsByRecency, type RoomMetaByRoomId } from './room-builders';
import { ChatAuthBadge } from './chat-auth-badge';
import { SyncStatusChip } from './sync-status-chip';
import { ChatRoomSidebar } from './chat-room-sidebar';
import { ChatEmptyState } from './chat-empty-state';
import { ChatPanel, type ChatContextPanel } from './ChatPanel';
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
  const [contextPanel, setContextPanel] = useState<ChatContextPanel>(null);
  const [isRoomListCollapsed, setIsRoomListCollapsed] = useState(false);
  const [mobileRoomListOpen, setMobileRoomListOpen] = useState(false);

  // Keep SSR and the first client render consistent; narrow screens use a drawer.
  const narrowViewport = useSyncExternalStore(subscribeNarrowViewport, getNarrowViewport, () => false);

  // Publish the open room to the global sync loop (via the room-meta store)
  // so it merges live timeline events into that room's message cache. Written
  // on every selection change; cleared when the room list is empty.
  const handleSelectRoom = useCallback((roomId: string) => {
    useRoomMetaStore.getState().setActiveRoomId(roomId);
    setSelectedRoomId(roomId);
    setContextPanel(null);
    setMobileRoomListOpen(false);
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
      handleSelectRoom(pendingChatRoomId);
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

  if (hasError) {
    return <ApiErrorState />;
  }

  // The section-level bar was merged into the room layout: sync health and the
  // Matrix session now live at the foot of the room list, which is the only
  // place they stay visible while the chat fills the panel.
  const sessionFooter = (
    <div className="flex flex-wrap items-center gap-1.5">
      <SyncStatusChip />
      <ChatAuthBadge
        compact
        isLoggedIn={isLoggedIn}
        userId={userId}
        onLogout={logout}
        onLoginClick={() => setShowLoginDialog(true)}
        showLoginDialog={showLoginDialog}
        onLoginDialogChange={setShowLoginDialog}
      />
    </div>
  );

  return (
    <ChatProvider>
      <RuntimeMapProvider map={runtimeMap}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
          {isRoomListCollapsed && !narrowViewport && (
            <div className="w-10 shrink-0 border-r border-border bg-muted/20 pt-2">
              <Button
                variant="ghost"
                size="sm"
                className="mx-auto h-7 w-7 p-0"
                onClick={() => setIsRoomListCollapsed(false)}
                title="显示会话列表"
              >
                <PanelLeftOpen className="w-3.5 h-3.5" />
              </Button>
              {/* Collapsed rail keeps the session signal the old bar carried. */}
              <span
                role="status"
                aria-label={isLoggedIn ? 'Matrix 已连接' : 'Matrix 未连接'}
                title={isLoggedIn ? 'Matrix 已连接' : 'Matrix 未连接'}
                className={`mx-auto mt-2 block h-2 w-2 rounded-full ${
                  isLoggedIn ? 'animate-pulse bg-emerald-500' : 'bg-amber-500'
                }`}
              />
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
              footer={sessionFooter}
            />

          )}

          {narrowViewport && mobileRoomListOpen && (
            <>
              <button
                type="button"
                aria-label="关闭空间列表"
                className="fixed inset-0 z-40 bg-background/70 md:hidden"
                onClick={() => setMobileRoomListOpen(false)}
              />
              <div className="fixed inset-y-0 left-0 z-50 max-w-[88vw] shadow-xl md:hidden [&>div]:h-full">
                <ChatRoomSidebar
                  rooms={rooms}
                  selectedRoomId={selectedRoomId}
                  onSelectRoom={handleSelectRoom}
                  isLoggedIn={isLoggedIn}
                  userId={userId}
                  isLoading={isLoading}
                  onCollapse={() => setMobileRoomListOpen(false)}
                  footer={sessionFooter}
                />
              </div>
            </>
          )}

          {/* Center: Chat panel */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {/* Narrow viewports hide the room list behind a drawer, so the
                trigger needs a row of its own above the conversation. */}
            {narrowViewport && (
              <div className="flex shrink-0 items-center border-b border-border bg-card/40 px-2 py-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs"
                  onClick={() => setMobileRoomListOpen(true)}
                  title="打开空间列表"
                  aria-label="打开空间列表"
                >
                  <PanelLeftOpen className="w-4 h-4" aria-hidden="true" />
                  空间列表
                </Button>
              </div>
            )}
            {selectedRoom ? (
              // key forces a fresh ChatRoom instance per room so input,
              // in-flight local messages and scroll state never leak across
              // rooms when switching conversations.
              <ChatPanel
                key={selectedRoom.id}
                room={selectedRoom}
                rooms={rooms}
                contextPanel={contextPanel}
                onContextPanelChange={setContextPanel}
              />
            ) : (
              <ChatEmptyState
                isLoggedIn={isLoggedIn}
                onLoginClick={() => setShowLoginDialog(true)}
              />
            )}
          </div>
        </div>
      </div>
      </RuntimeMapProvider>
    </ChatProvider>
  );
}
