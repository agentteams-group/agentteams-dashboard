'use client';

import { useState, useMemo, useCallback, useEffect, useSyncExternalStore, useRef } from 'react';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useTeams } from '@/hooks/use-agentteams-teams';
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useHumans } from '@/hooks/use-agentteams-humans';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useMatrixStore } from '@/lib/matrix-store';
import { useSectionStore } from '@/lib/section-store';
import { useRoomMetaStore } from '@/hooks/use-matrix';
import { ApiErrorState } from '@/components/dashboard/api-error-state';
import { AlertTriangle, PanelLeftOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-error';
import { buildRooms, sortRoomsByRecency, type RoomMetaByRoomId } from './room-builders';
import { ChatAuthBadge } from './chat-auth-badge';
import { SyncStatusChip } from './sync-status-chip';
import { ServerCapabilityPopover } from './server-capability-popover';
import { ChatRoomSidebar } from './chat-room-sidebar';
import { ChatEmptyState } from './chat-empty-state';
import { ChatPanel, type ChatContextPanel } from './ChatPanel';
import { MatrixStatusBanner } from './matrix-status-banner';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { ChatProvider } from './ChatStore';
import { RuntimeMapProvider, type RuntimeMap } from './runtime-map-context';
import { preferredAgentRoom, withLeaderAccess, canOpenConversation, conversationStorageKey, LEADER_ACCESS_LABELS } from './agent-conversations';
import { useChatRoomAccess } from '@/hooks/use-chat-room-access';
import { useAssistantTaskFeed } from '@/hooks/use-assistant-task-feed';
import { assistantTaskNotes, attentionCounts } from '@/lib/assistant-task-notes';
import { ConversationSwitcher } from './conversation-switcher';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

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

export function ChatSection({ view = 'all' }: { view?: 'all' | 'assistants' | 'teams' } = {}) {
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
  const { isConnected, userLevel, sessionUser } = useAgentTeamsStore();
  const { isLoggedIn, userId, homeserver, logout } = useMatrixStore();
  const accountKey = conversationStorageKey(homeserver, userId || sessionUser || '');
  const selectionKey = accountKey && view !== 'all' ? `${accountKey}:${view}` : accountKey;
  const roomAccess = useChatRoomAccess();
  const switcherRef = useRef<HTMLButtonElement>(null);

  const [selection, setSelection] = useState<{ scope: string | null; id: string | null }>({ scope: null, id: null });
  const selectedRoomId = selection.scope === selectionKey ? selection.id : null;
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [contextPanel, setContextPanel] = useState<ChatContextPanel>(null);
  const [isRoomListCollapsed, setIsRoomListCollapsed] = useState(view !== 'teams');
  const [mobileRoomListOpen, setMobileRoomListOpen] = useState(false);

  // Keep SSR and the first client render consistent; narrow screens use a drawer.
  const narrowViewport = useSyncExternalStore(subscribeNarrowViewport, getNarrowViewport, () => false);

  const isLoading = workersLoading || teamsLoading || managersLoading || humansLoading;
  const hasError = !isConnected;

  // ChatIR needs every Agent's runtime to assemble process events into turns.
  const runtimeMap = useMemo<RuntimeMap>(() => {
    const map: RuntimeMap = {};
    for (const worker of workers ?? []) {
      if (worker.matrixUserID) {
        map[worker.matrixUserID] = { runtime: worker.runtime, workerName: worker.name };
      }
    }
    for (const manager of managers ?? []) {
      if (manager.matrixUserID) {
        map[manager.matrixUserID] = {
          runtime: manager.runtime as RuntimeMap[string]['runtime'],
          workerName: manager.name,
        };
      }
    }
    return map;
  }, [workers, managers]);

  // Per-room meta (lastMessageTs + unread counts) feeds the sidebar sort and
  // badge. We don't re-sort on every keystroke — just pass the meta to
  // buildRooms and sort at the boundary.
  const roomMeta = useRoomMetaStore((s) => s.meta);
  const availableRooms = useMemo(
    () => withLeaderAccess(sortRoomsByRecency(buildRooms(workers, teams, managers, roomMeta as RoomMetaByRoomId, humans)), roomAccess.joinedRooms, roomAccess.state)
      .filter(room => room.access === 'joined' && (userLevel >= 3 || room.agentRole !== 'operations'))
      .map(room => ({ ...room, teamRole: room.team ? (room.team.admin ? room.team.admin.name === sessionUser : userLevel >= 3) ? 'admin' as const : 'member' as const : undefined })),
    [workers, teams, managers, humans, roomMeta, roomAccess.joinedRooms, roomAccess.state, userLevel, sessionUser],
  );
  const rooms = useMemo(() => availableRooms.filter(room => view === 'all' || (view === 'teams' ? room.type === 'team' : room.agentRole === 'operations' || room.agentRole === 'leader' && room.teamRole === 'admin')), [availableRooms, view]);
  const taskFeed = useAssistantTaskFeed(undefined, rooms.some(room => room.agentRole || room.type === 'team'));
  const confirmations = useHitlInboxStore(state => state.confirmations);
  const attention = useMemo(() => Object.fromEntries(rooms.filter(room => room.agentRole || room.type === 'team').map(room => [room.id, attentionCounts(assistantTaskNotes(room, rooms, taskFeed.workflows, confirmations))])), [rooms, taskFeed.workflows, confirmations]);
  const attentionPending = taskFeed.degraded || taskFeed.partialError ? '任务数据待更新' : taskFeed.loading ? '任务同步中…' : undefined;

  const handleSelectRoom = useCallback((roomId: string, remember = true) => {
    const room = availableRooms.find(room => room.id === roomId);
    if (!room || !canOpenConversation(room)) return;
    if (view !== 'all' && (view === 'teams') !== (room.type === 'team')) {
      useHitlInboxStore.getState().setPendingChatRoomId(roomId);
      useSectionStore.getState().setActiveSection(room.type === 'team' ? 'my-teams' : 'chat');
      return;
    }
    if (remember) {
      useHitlInboxStore.getState().takePendingChatRoomId();
      if (selectionKey) {
        try { window.localStorage.setItem(selectionKey, roomId); } catch { /* Non-persistent browser. */ }
      }
    }
    useRoomMetaStore.getState().setActiveRoomId(roomId);
    setSelection({ scope: selectionKey, id: roomId });
    setContextPanel(null);
    setMobileRoomListOpen(false);
  }, [availableRooms, selectionKey, view]);


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

  useEffect(() => {
    const active = selectedRoomId && rooms.some((room) => room.id === selectedRoomId && canOpenConversation(room)) ? selectedRoomId : null;
    useRoomMetaStore.getState().setActiveRoomId(active);
  }, [selectedRoomId, rooms]);

  // Deep-link consumption: read the pending value WITHOUT clearing it, and
  // only take (clear) it once the room list is loaded and actually contains
  // the target room. FUNC-04: clearing unconditionally during render dropped
  // the deep link whenever the rooms list was still loading.
  //
  // f4-1: runs as an effect, NOT in the render body — handleSelectRoom writes
  // useRoomMetaStore.setActiveRoomId, which has mounted subscribers (room
  // header, task dots). Writing a subscribed store during this component's
  // render trips "Cannot update a component while rendering a different
  // component" whenever another subscribed component renders concurrently
  // (same failure mode recorded at tasks-section.tsx:652-669). Effects run
  // post-commit, so the write is safe; FUNC-04 semantics (consume only once
  // rooms are loaded and contain the target) are unchanged.
  //
  // Declared AFTER the clear-guard effect above: within one commit effects
  // run in declaration order, so consumption wins over the guard's
  // setActiveRoomId(null) while selectedRoomId still holds the pre-link value.
  const pendingChatRoomId = useHitlInboxStore((state) => state.pendingChatRoomId);
  useEffect(() => {
    if (isLoading) return;
    if (pendingChatRoomId) {
      const target = availableRooms.find(room => room.id === pendingChatRoomId);
      if (target && canOpenConversation(target)) {
        useHitlInboxStore.getState().takePendingChatRoomId();
        handleSelectRoom(pendingChatRoomId, false);
      }
      return;
    }
    if (availableRooms.some(room => room.id === selectedRoomId && canOpenConversation(room))) return;
    if (roomAccess.state === 'checking' && rooms.some(room => room.agentRole === 'leader')) return;
    let rememberedId: string | null = null;
    if (selectionKey) {
      try { rememberedId = window.localStorage.getItem(selectionKey); } catch { /* Non-persistent browser. */ }
    }
    const preferred = view === 'teams'
      ? rooms.find(room => room.id === rememberedId) ?? [...rooms].sort((a, b) => (a.parentTeam ?? '').localeCompare(b.parentTeam ?? ''))[0]
      : preferredAgentRoom(rooms, userLevel ?? 3, rememberedId);
    if (preferred) handleSelectRoom(preferred.id, false);
  }, [isLoading, pendingChatRoomId, rooms, availableRooms, selectedRoomId, userLevel, handleSelectRoom, selectionKey, roomAccess.state, view]);
  const selectedRoom = useMemo(
    () => availableRooms.find((r) => r.id === selectedRoomId && canOpenConversation(r)) || null,
    [availableRooms, selectedRoomId],
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
      {/* B-6：连接好不好与能力有没有是 two questions，后者需要一个能展开看原因的入口。 */}
      <ServerCapabilityPopover />
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
        {!selectedRoom && (
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-1 sm:px-6">
          <Button ref={switcherRef} variant="ghost" size="icon" className="size-9 shrink-0 text-muted-foreground" aria-label="打开空间列表" title="打开对话列表" onClick={() => narrowViewport ? setMobileRoomListOpen(true) : setIsRoomListCollapsed((value) => !value)}>
            <PanelLeftOpen className="size-4" />
          </Button>
          <div className="min-w-0 flex-1"><ConversationSwitcher rooms={rooms} relatedRooms={availableRooms} selectedRoomId={selectedRoomId} onSelectRoom={handleSelectRoom} attention={attention} pending={attentionPending} /></div>
          <SyncStatusChip />
        </div>
        )}
        {projectionNotices.map((notice) => (
          <div
            key={notice.key}
            className="shrink-0 mx-4 mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300"
            role="status"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <p className="flex-1">{notice.message}</p>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={notice.retry}>
              重试
            </Button>
          </div>
        ))}

        {roomAccess.state === 'error' && <div role="status" className="mx-4 flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground"><span className="flex-1">对话成员身份暂时无法核验，请重试。</span><Button variant="ghost" size="sm" onClick={() => { void roomAccess.refetch(); }}>重新核验</Button></div>}
        {pendingChatRoomId && rooms.some(room => room.id === pendingChatRoomId && !canOpenConversation(room)) && <p role="status" className="mx-4 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">{LEADER_ACCESS_LABELS[rooms.find(room => room.id === pendingChatRoomId)!.access as keyof typeof LEADER_ACCESS_LABELS]}</p>}
        {/* Login banner */}
        {!isLoggedIn && (
          <MatrixStatusBanner isLoggedIn={isLoggedIn} onLoginClick={() => setShowLoginDialog(true)} />
        )}

        {/* Main content: 2 or 3 column flex */}
        <div className="flex-1 flex min-h-0">
          {/* Left: Room list */}
          {!isRoomListCollapsed && !narrowViewport && (
            <ChatRoomSidebar
              rooms={rooms}
              title={view === 'teams' ? '我的团队' : view === 'assistants' ? '助手' : undefined}
              showInvites={view !== 'assistants'}
              selectedRoomId={selectedRoomId}
              onSelectRoom={handleSelectRoom}
              isLoggedIn={isLoggedIn}
              userId={userId}
              isLoading={isLoading}
              onCollapse={() => setIsRoomListCollapsed(true)}
              footer={sessionFooter}
              attention={attention}
              attentionPending={attentionPending}
            />

          )}

          <Dialog open={narrowViewport && mobileRoomListOpen} onOpenChange={setMobileRoomListOpen}>
            <DialogContent aria-modal="true" showCloseButton={false} className="inset-y-0 left-0 top-0 flex h-dvh w-fit max-w-[88vw] translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-background p-0 sm:max-w-[88vw] [&>div]:h-full" onCloseAutoFocus={event => { event.preventDefault(); switcherRef.current?.focus(); }}>
              <DialogTitle className="sr-only">切换对话</DialogTitle>
              <DialogDescription className="sr-only">选择平台助手、团队助手或其他对话</DialogDescription>
              <ChatRoomSidebar rooms={rooms} title={view === 'teams' ? '我的团队' : view === 'assistants' ? '助手' : undefined} showInvites={view !== 'assistants'} selectedRoomId={selectedRoomId} onSelectRoom={handleSelectRoom} isLoggedIn={isLoggedIn} userId={userId} isLoading={isLoading} onCollapse={() => setMobileRoomListOpen(false)} footer={sessionFooter} attention={attention} attentionPending={attentionPending} />
            </DialogContent>
          </Dialog>

          {/* Center: Chat panel */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {selectedRoom ? (
              // key forces a fresh ChatRoom instance per room so input,
              // in-flight local messages and scroll state never leak across
              // rooms when switching conversations.
              <ChatPanel
                key={selectedRoom.id}
                room={selectedRoom}
                managerName={selectedRoom.agentRole === 'operations' ? managers?.find((manager) => manager.roomID === selectedRoom.id)?.name : undefined}
                rooms={availableRooms}
                contextPanel={contextPanel}
                onContextPanelChange={setContextPanel}
                taskFeed={taskFeed}
                headerLeading={<Button ref={switcherRef} variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" aria-label="打开空间列表" title="打开对话列表" onClick={() => narrowViewport ? setMobileRoomListOpen(true) : setIsRoomListCollapsed(value => !value)}><PanelLeftOpen className="size-4" /></Button>}
                headerTitle={<ConversationSwitcher rooms={rooms} relatedRooms={availableRooms} selectedRoomId={selectedRoomId} onSelectRoom={handleSelectRoom} attention={attention} pending={attentionPending} />}

              />
            ) : (
              <ChatEmptyState
                isLoggedIn={isLoggedIn}
                view={view}
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
