'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useTeams } from '@/hooks/use-agentteams-teams';
import { belongsToTeam } from '@/lib/collaboration-files';
import { AttachmentTeamsContext } from './save-to-human-files';
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useHumans } from '@/hooks/use-agentteams-humans';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useMatrixStore } from '@/lib/matrix-store';
import { useSectionStore } from '@/lib/section-store';
import { WelcomeSteps } from '../welcome-steps';
import { openChatRoom } from '@/lib/open-chat-room';
import { useRoomMetaStore } from '@/hooks/use-matrix';
import { ApiErrorState } from '@/components/dashboard/api-error-state';
import { AlertTriangle, ArrowLeft, Bot, ChevronDown, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-error';
import { buildRooms, sortRoomsByRecency, type RoomMetaByRoomId } from './room-builders';
import type { RoomInfo } from './room-info';
import { MatrixLoginForm } from './matrix-login-form';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChatRoomSidebar, InviteInbox } from './chat-room-sidebar';
import { ChatEmptyState } from './chat-empty-state';
import { ChatPanel, type ChatContextPanel } from './ChatPanel';
import { MatrixStatusBanner } from './matrix-status-banner';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { ChatProvider } from './ChatStore';
import { RuntimeMapProvider, type RuntimeMap } from './runtime-map-context';
import { preferredAgentRoom, withLeaderAccess, canOpenConversation, conversationStorageKey, LEADER_ACCESS_LABELS } from './agent-conversations';
import { useChatRoomAccess } from '@/hooks/use-chat-room-access';
import { useArchivedRooms } from '@/hooks/use-room-archive';
import { useAssistantTaskFeed } from '@/hooks/use-assistant-task-feed';
import { assistantTaskNotes, attentionCounts } from '@/lib/assistant-task-notes';
import { RelatedConversationButton } from './conversation-switcher';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useHoverOpen } from '@/lib/desktop-interactions';
import { useApiTaskBoard } from '@/hooks/use-projects';
import { isTeamAdmin } from '@/lib/team-access';
import { AssistantRoomList } from './assistant-room-list';
import { TeamRoomList } from './team-room-list';

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
  const { isLoggedIn, userId, homeserver } = useMatrixStore();
  const accountKey = conversationStorageKey(homeserver, userId || sessionUser || '');
  const selectionKey = accountKey && view !== 'all' ? `${accountKey}:${view}` : accountKey;
  const roomAccess = useChatRoomAccess();
  const archivedRooms = useArchivedRooms();
  const roomPicker = useHoverOpen({});
  const setRoomPickerOpen = roomPicker.setOpen;

  const [selection, setSelection] = useState<{ scope: string | null; id: string | null }>({ scope: null, id: null });
  const taskCollaboration = useSectionStore((state) => state.taskCollaboration);
  const selectedRoomId = taskCollaboration?.roomId ?? (selection.scope === selectionKey ? selection.id : null);
  const pendingChatRoomId = useHitlInboxStore((state) => state.pendingChatRoomId);
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [contextPanel, setContextPanel] = useState<ChatContextPanel>(null);
  const [roomNotice, setRoomNotice] = useState<string | null>(null);

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
  // Controller 项目工作流是项目群的第二来源：/sync 没采集到 m.room.name 时
  // source_room_id 仍能补齐侧栏房间。这里始终拉取（enabled=true），同一份
  // taskFeed 继续驱动 attention 徽标，不额外发起第二套 projects 查询。
  const taskFeed = useAssistantTaskFeed(undefined, true);
  const taskBoard = useApiTaskBoard();
  const availableRooms = useMemo(
    () => {
      const projected = buildRooms(workers, teams, managers, roomMeta as RoomMetaByRoomId, humans, taskFeed.workflows);
      for (const task of taskBoard.tasks) {
        const id = task.executionRoomId?.replace(/^room:/, '');
        if (id && !projected.some(room => room.id === id)) projected.push({ id, name: roomMeta[id]?.roomName || task.title, type: 'project', members: [], parentTeam: task.teamId, teamId: task.teamId, projectId: task.projectId });
      }
      for (const archived of archivedRooms.data?.rooms ?? []) {
        const existing = projected.find(room => room.id === archived.room_id);
        if (existing) existing.archived = true;
        else projected.push({ id: archived.room_id, name: archived.name || '任务房间', type: 'project', members: [], parentTeam: archived.room_meta?.teamName, archived: true, memberCount: archived.joined_member_count });
      }
      // Legacy Controllers omit task rooms; /sync can also lag room names.
      // A deep link may still open a room verified by this user's membership.
      for (const id of [pendingChatRoomId, selectedRoomId]) {
        if (id && roomAccess.state === 'joined' && roomAccess.joinedRooms?.includes(id) && !projected.some(room => room.id === id)) {
          projected.push({ id, name: roomMeta[id]?.roomName || '协作房间', type: 'unknown', members: [] });
        }
      }
      return withLeaderAccess(sortRoomsByRecency(projected), roomAccess.joinedRooms, roomAccess.state)
      .filter(room => (userLevel >= 3 || room.agentRole !== 'operations') && (room.agentRole !== 'leader' || !!room.team && isTeamAdmin(room.team, sessionUser, userId)))
      .map(room => ({ ...room, teamRole: room.team ? isTeamAdmin(room.team, sessionUser, userId) ? 'admin' as const : 'member' as const : undefined }));
    },
    [workers, teams, managers, humans, roomMeta, taskFeed.workflows, taskBoard.tasks, roomAccess.joinedRooms, roomAccess.state, userLevel, sessionUser, userId, pendingChatRoomId, selectedRoomId, archivedRooms.data],
  );
  // Project deep links still open here; the sidebar lists joined teams only.
  const isTeamViewRoom = useCallback((room: RoomInfo) => room.type === 'team' || room.type === 'project' || room.type === 'unknown' && /^TASK[：:]/i.test(room.name), []);
  const rooms = useMemo(() => availableRooms.filter(room => !room.archived && (view === 'assistants'
    ? !!room.agentRole
    : canOpenConversation(room) && (view === 'all' || isTeamViewRoom(room)))), [availableRooms, view, isTeamViewRoom]);
  const confirmations = useHitlInboxStore(state => state.confirmations);
  const attention = useMemo(() => Object.fromEntries(rooms.filter(room => room.agentRole || room.type === 'team').map(room => [room.id, attentionCounts(assistantTaskNotes(room, rooms, taskFeed.workflows, confirmations))])), [rooms, taskFeed.workflows, confirmations]);
  const attentionPending = taskFeed.degraded || taskFeed.partialError ? '任务数据待更新' : taskFeed.loading ? '任务同步中…' : undefined;
  const taskIdForRoom = useCallback((room: RoomInfo) => {
    if (room.type !== 'project' && room.type !== 'unknown') return undefined;
    return room.name.match(/^TASK[：:]\s*(.+)$/i)?.[1]
      ?? taskBoard.tasks.find(task => task.executionRoomId?.replace(/^room:/, '') === room.id)?.runId
      ?? taskFeed.workflows.flatMap(workflow => workflow.tasks_detail ?? []).find(task => task.room_id?.replace(/^room:/, '') === room.id)?.task_id;
  }, [taskFeed.workflows, taskBoard.tasks]);

  const handleSelectRoom = useCallback((roomId: string, remember = true) => {
    const room = availableRooms.find(room => room.id === roomId);
    if (!room || !canOpenConversation(room)) return;
    const context = useSectionStore.getState().taskCollaboration;
    const taskId = taskIdForRoom(room);
    if (taskId) {
      useSectionStore.setState({ activeSection: 'chat', taskCollaboration: { taskId, roomId } });
    } else if (context && context.roomId !== roomId) {
      openChatRoom(roomId);
      return;
    }
    if (!taskId && view !== 'all' && (view === 'teams') !== isTeamViewRoom(room)) {
      useHitlInboxStore.getState().setPendingChatRoomId(roomId);
      useSectionStore.getState().setActiveSection(isTeamViewRoom(room) ? 'my-teams' : 'chat');
      return;
    }
    if (remember) {
      setRoomNotice(null);
      useHitlInboxStore.getState().takePendingChatRoomId();
      if (selectionKey) {
        try { window.localStorage.setItem(selectionKey, roomId); } catch { /* Non-persistent browser. */ }
      }
    }
    useRoomMetaStore.getState().setActiveRoomId(roomId);
    setSelection({ scope: selectionKey, id: roomId });
    setContextPanel(null);
    setRoomPickerOpen(false);
  }, [availableRooms, selectionKey, view, isTeamViewRoom, taskIdForRoom, setRoomPickerOpen]);


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
    const active = selectedRoomId && availableRooms.some((room) => room.id === selectedRoomId && canOpenConversation(room)) ? selectedRoomId : null;
    useRoomMetaStore.getState().setActiveRoomId(active);
  }, [selectedRoomId, availableRooms]);

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
  useEffect(() => {
    if (isLoading) return;
    if (pendingChatRoomId) {
      const privateTeam = teams?.find(team => team.leaderDMRoomID === pendingChatRoomId);
      if (privateTeam && !isTeamAdmin(privateTeam, sessionUser, userId)) {
        useHitlInboxStore.getState().takePendingChatRoomId();
        setRoomNotice('团队助手私聊仅对该团队的 Team Admin 开放。你可以在「我的团队」参与群聊。');
        return;
      }
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
      ? rooms.find(room => room.type === 'team' && room.id === rememberedId) ?? [...rooms].filter(room => room.type === 'team').sort((a, b) => (a.parentTeam ?? '').localeCompare(b.parentTeam ?? ''))[0]
      : preferredAgentRoom(rooms, userLevel ?? 3, rememberedId);
    if (preferred) handleSelectRoom(preferred.id, false);
  }, [isLoading, pendingChatRoomId, rooms, availableRooms, selectedRoomId, userLevel, handleSelectRoom, selectionKey, roomAccess.state, view, teams, sessionUser, userId]);
  const selectedRoom = useMemo(
    () => availableRooms.find((r) => r.id === selectedRoomId && canOpenConversation(r)) || null,
    [availableRooms, selectedRoomId],
  );
  const selectedTaskId = selectedRoom ? taskIdForRoom(selectedRoom) : undefined;
  useEffect(() => {
    if (!selectedRoom || !selectedTaskId) return;
    const context = useSectionStore.getState().taskCollaboration;
    if (context?.roomId === selectedRoom.id && context.taskId === selectedTaskId) return;
    useSectionStore.setState({ activeSection: 'chat', taskCollaboration: { taskId: selectedTaskId, roomId: selectedRoom.id } });
  }, [selectedRoom, selectedTaskId]);

  if (hasError) {
    return <ApiErrorState />;
  }

  const pickerLabel = view === 'assistants' ? '切换助手' : view === 'teams' ? '切换团队' : '切换团队及任务房间';
  const roomSelector = (
    <Popover open={roomPicker.open} onOpenChange={roomPicker.setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" {...roomPicker.triggerProps} aria-label={pickerLabel} className="max-w-full gap-2 rounded-lg">
          {view === 'assistants' ? <Bot className="size-4 shrink-0" /> : <Users className="size-4 shrink-0" />}
          <span className="min-w-0 truncate">{selectedRoom?.type === 'team' ? selectedRoom.team?.teamName || selectedRoom.parentTeam || selectedRoom.name : selectedRoom?.name || (view === 'assistants' ? '选择助手' : view === 'teams' ? '选择团队' : '选择团队及任务房间')}</span>
          {view !== 'assistants' && selectedRoom?.teamRole && <span className="text-xs text-muted-foreground">{selectedRoom.teamRole === 'admin' ? '管理员' : '成员'}</span>}
          <ChevronDown className="size-3.5 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label={pickerLabel} align="start" className={`${view === 'all' ? 'h-[min(520px,70dvh)]' : ''} w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-xl p-0`} {...roomPicker.contentProps} onOpenAutoFocus={roomPicker.preserveFocus} onCloseAutoFocus={roomPicker.preserveFocus}>
        {view === 'assistants'
          ? <AssistantRoomList rooms={rooms} selectedRoomId={selectedRoomId} onSelectRoom={handleSelectRoom} />
          : view === 'teams' ? <TeamRoomList rooms={rooms} selectedRoomId={selectedRoomId} onSelectRoom={handleSelectRoom} isLoading={isLoading} attention={attention} attentionPending={attentionPending} />
          : <ChatRoomSidebar embedded rooms={rooms} title="团队及任务房间" showInvites={false} selectedRoomId={selectedRoomId} onSelectRoom={handleSelectRoom} isLoggedIn={isLoggedIn} userId={userId} isLoading={isLoading} onCollapse={() => roomPicker.setOpen(false)} attention={attention} attentionPending={attentionPending} />}
      </PopoverContent>
    </Popover>
  );

  return (
    <ChatProvider>
      <RuntimeMapProvider map={runtimeMap} humanUserIds={humans?.map(human => human.matrixUserID)}
        humanNames={Object.fromEntries((humans ?? []).filter(human => human.matrixUserID).map(human => [human.matrixUserID, human.name]))}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="workspace-content flex shrink-0 flex-wrap items-center justify-between gap-2 py-2">
          <p className="text-xs text-muted-foreground">{view === 'teams' ? '这里展示你已加入的团队群聊，包括你管理和参与的团队。' : taskCollaboration ? '跟进任务协作、执行进展与交付内容。' : '与 AT 助手或你管理团队的团队助手私聊，交代目标并跟进进展。'}</p>
        </div>
        {view !== 'assistants' && <div className="workspace-content"><InviteInbox /></div>}
        {!taskCollaboration && <div className="shrink-0 px-4"><WelcomeSteps visible={isLoggedIn && availableRooms.length === 0} /></div>}
        {taskCollaboration && (
          <nav aria-label="任务协作导航" className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2 text-sm sm:px-6">
            <Button variant="ghost" size="sm" className="shrink-0 gap-1" onClick={() => useSectionStore.getState().setActiveSection('tasks')}>
              <ArrowLeft className="size-4" />返回任务看板
            </Button>
            <span aria-hidden className="text-muted-foreground">/</span>
            <span className="min-w-0 truncate" title={taskCollaboration.taskId}>{taskCollaboration.taskId}</span>
            <span aria-hidden className="text-muted-foreground">/</span>
            <span aria-current="page">协作</span>
          </nav>
        )}
        {!selectedRoom && (
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-1 sm:px-6">
          <div className="min-w-0 flex-1">{roomSelector}</div>
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
        {roomNotice && <p role="status" className="mx-4 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground">{roomNotice}</p>}
        {/* Login banner */}
        {!isLoggedIn && (
          <MatrixStatusBanner isLoggedIn={isLoggedIn} onLoginClick={() => setShowLoginDialog(true)} />
        )}
        <Dialog open={showLoginDialog} onOpenChange={setShowLoginDialog}>
          <DialogContent className="max-w-[95vw] sm:max-w-sm">
            <DialogHeader><DialogTitle>重新连接对话</DialogTitle></DialogHeader>
            <MatrixLoginForm onLoginSuccess={() => setShowLoginDialog(false)} />
          </DialogContent>
        </Dialog>

        {/* Main content: 2 or 3 column flex */}
        <div className="flex-1 flex min-h-0">
          {/* Left: Room list */}
          {/* Center: Chat panel */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {selectedRoom ? (
              // key forces a fresh ChatRoom instance per room so input,
              // in-flight local messages and scroll state never leak across
              // rooms when switching conversations.
              <AttachmentTeamsContext.Provider value={{
                teams: (teams ?? []).filter(team => belongsToTeam(team, sessionUser)),
                preferredTeam: selectedRoom.team?.name ?? teams?.find(team => team.name === selectedRoom.parentTeam || team.teamName === selectedRoom.parentTeam)?.name,
              }}>
              <ChatPanel
                key={selectedRoom.id}
                room={selectedRoom}
                taskId={taskCollaboration?.roomId === selectedRoom.id ? taskCollaboration.taskId : undefined}
                managerName={selectedRoom.agentRole === 'operations' ? managers?.find((manager) => manager.roomID === selectedRoom.id)?.name : undefined}
                contextPanel={contextPanel}
                onContextPanelChange={setContextPanel}
                taskBoard={taskBoard}
                headerTitle={taskCollaboration ? <span className="truncate font-semibold">{selectedRoom.name}</span> : roomSelector}
                headerActions={<RelatedConversationButton rooms={availableRooms.filter(room => !room.archived && canOpenConversation(room))} selectedRoomId={selectedRoomId} onSelectRoom={handleSelectRoom} />}

              />
              </AttachmentTeamsContext.Provider>
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
