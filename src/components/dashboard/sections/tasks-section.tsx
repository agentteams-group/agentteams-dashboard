'use client';

import { isDesktopHover } from '@/lib/desktop-interactions';
import { taskStatus } from '@/lib/task-status';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useShallow } from 'zustand/shallow';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  ListTodo,
  Search,
  MessageSquare,
  FolderTree,
  Layers,
  Sparkles,
  RefreshCw,
  Database,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { SectionEmptyState } from '@/components/dashboard/section-empty-state';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SectionHeader } from '@/components/dashboard/section-header';
import { ArchivedRoomsDialog } from './chat/room-archive';
import { useArchivedRooms } from '@/hooks/use-room-archive';
import { currentHashParams, tasksHash } from '@/lib/nav-hash';
import { useMatrixStore } from '@/lib/matrix-store';
import { useActiveSection } from '@/components/dashboard/use-active-section';
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import {
  useMergedTaskBoard,
  useLogTaskBoardScan,
  type BoardTask,
  type TaskStatus,
} from '@/hooks/use-task-board';
import { useApiTaskBoard } from '@/hooks/use-projects';
import { useProjectRoomTimestamps } from '@/hooks/use-project-room-ts';
import { WorkflowDetail } from './projects/workflow-detail';
import { useTaskStore } from '@/lib/task-store';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { openChatRoom } from '@/lib/open-chat-room';
import { mainTasks, subtasksOf } from '@/lib/task-hierarchy';
import { usePersistentState } from '@/lib/use-persistent-state';
import { isStaleProjectSelection } from './task-selectors';
import {
  findManagerByMatrixId,
  findWorkerByName,
  ProjectCard,
  ProjectDagView,
  ProjectPlanPreview,
  ProjectStatusBadge,
  TaskCard,
} from './task-section-cards';
import { TASK_STATUS_COLUMNS, TaskDetailSheet } from './task-detail-sheet';

// ----- Main section -----

type ViewMode = 'kanban' | 'projects';

const TASKS_VIEW_KEY = 'agentteams:tasks-view';
const TASKS_PROJECT_KEY = 'agentteams:tasks-selected-project';

const isTasksViewMode = (raw: unknown): raw is ViewMode =>
  raw === 'kanban' || raw === 'projects';

// null = no explicit selection (the board auto-shows the first project);
// only non-empty strings are restored from storage.
const isProjectIdOrNone = (raw: unknown): raw is string | null =>
  raw === null || (typeof raw === 'string' && raw.length > 0);

export function TasksSection() {
  const reduceMotion = useReducedMotion();
  const { setActiveSection } = useActiveSection();
  const matrixLoggedIn = useMatrixStore((s) => s.isLoggedIn);
  const archivedRooms = useArchivedRooms({}, matrixLoggedIn);
  const archivedRoomIds = useMemo(() => new Set(archivedRooms.data?.rooms.map(room => room.room_id) ?? []), [archivedRooms.data]);
  const clearTasks = useTaskStore((s) => s.clearTasks);

  // D5 双轨：主源 = Controller projects/workflow API（standardized），
  // 降级 = MinIO 直读看板（API 未部署/Controller 故障时 fallback）。
  // Matrix 实时事件（useTaskStore）作为叠加层两轨共享。
  const apiBoard = useApiTaskBoard();
  const minioBoard = useMergedTaskBoard({
    refetchInterval: 5000,
    enabled: apiBoard.degraded,
  });
  const primary = apiBoard.degraded ? minioBoard : apiBoard;
  useLogTaskBoardScan(
    minioBoard.matchedPrefixes,
    minioBoard.scannedKeys,
    minioBoard.bucket,
    minioBoard.error,
  );

  // Live events fill missing tasks; persisted states remain authoritative
  // so an older chat snapshot cannot undo the latest polling response.
  const live = useTaskStore(useShallow((s) => s.tasks));
  const board = useMemo(() => {
    const byId = new Map<string, (typeof primary.tasks)[number]>();
    for (const t of primary.tasks) byId.set(t.runId, t);
    for (const [, e] of Object.entries(live)) {
      const existing = byId.get(e.runId);
      const liveTask = {
        runId: e.runId,
        title: e.title,
        status: e.status as TaskStatus,
        assignedTo: e.senderMatrixUserId,
        roomId: e.roomId,
        projectId: existing?.projectId,
        dependsOn: existing?.dependsOn ?? [],
        createdAt: e.createdAt,
        completedAt: existing?.completedAt,
        outcome: existing?.outcome ?? null,
        spec: existing?.spec,
        source: 'matrix-live',
      };
      byId.set(
        e.runId,
        existing ?? liveTask,
      );
    }
    return {
      ...primary,
      tasks: Array.from(byId.values()).filter(task => {
        if (task.executionRoomId && archivedRoomIds.has(task.executionRoomId)) return false;
        const children = Array.from(byId.values()).filter(child => child.parentTaskId === task.runId);
        return !children.length || !children.every(child => child.executionRoomId && archivedRoomIds.has(child.executionRoomId));
      }).sort((a, b) => b.createdAt - a.createdAt),
    };
  }, [primary, live, archivedRoomIds]);

  const projectTotal = 'projectTotal' in board ? board.projectTotal : board.projects.length;
  const hasMoreProjects = 'hasMoreProjects' in board && board.hasMoreProjects;
  const loadMoreProjects = 'loadMoreProjects' in board ? board.loadMoreProjects : undefined;
  const isWorkflowsLoading = 'isWorkflowsLoading' in board && board.isWorkflowsLoading;

  const { data: managers } = useManagers();
  const { data: workers } = useWorkers();

  // View + project selection survive section switches and refreshes
  // (post-mount restore; a deep link consumed during first render wins).
  const [view, setView] = usePersistentState<ViewMode>(
    TASKS_VIEW_KEY,
    'kanban',
    isTasksViewMode,
  );
  const [search, setSearch] = useState('');
  const [selectedTaskKey, setSelectedTaskKey] = useState<{ id: string; team?: string } | null>(null);
  const matchesSelectedTask = (task: BoardTask) => selectedTaskKey && task.runId === selectedTaskKey.id &&
    (!selectedTaskKey.team || task.teamId === selectedTaskKey.team);
  const boardSelection = board.tasks.find(matchesSelectedTask);
  // A conversation can still link to a task hidden from the board by archiving.
  const selectedTask = boardSelection ?? primary.tasks.find(matchesSelectedTask) ?? null;
  const selectTask = (task: BoardTask) => setSelectedTaskKey({ id: task.runId, team: task.teamId });
  const closeTask = () => {
    setSelectedTaskKey(null);
    const params = currentHashParams();
    if (window.location.hash.split('?')[0] !== tasksHash() || !params?.has('task')) return;
    params.delete('task');
    params.delete('team');
    window.history.replaceState(window.history.state, '', params.size ? `${tasksHash()}?${params}` : tasksHash());
  };
  const [selectedProjectId, setSelectedProjectId] = usePersistentState<
    string | null
  >(TASKS_PROJECT_KEY, null, isProjectIdOrNone);
  const [reloadKey, setReloadKey] = useState(0);

  // 项目视图左栏排序（9/16 装验反馈第 2/3/4 轮：左栏项目要能按时间排序）。
  // 9/16 真机 E2E 定位：独立 ProjectsSection 已并入任务看板（nav-items 注释
  // 「项目视图已并入任务看板」），修复必须落在本视图——与插件 WorkflowBoard
  // 同款语义（时间新→旧 默认）。
  const [projSort, setProjSort] = useState<'time_desc' | 'time_asc' | 'name'>(
    'time_desc',
  );
  // 9/17 装验第 7 轮：controller projectSummary 无时间戳（源码实锤：struct
  // 仅 6 字段）且 proj-<uuid> 无内嵌日期 → 时间排序对 API 项目无数据可用，
  // 静默退化为名称序。兜底第三源 = 项目房间最后一条消息 ts（与插件
  // projectActivityTs 同款语义，60s 缓存，limit 1）；名称排序时零请求。
  const roomTs = useProjectRoomTimestamps(board.projects, projSort !== 'name');
  const sortedProjects = useMemo(() => {
    const list = [...board.projects];
    list.sort((a, b) => {
      if (projSort === 'name') {
        return a.name.localeCompare(b.name, 'en');
      }
      const ta = (a.completedAt ?? a.createdAt) || roomTs.get(a.runId) || 0;
      const tb = (b.completedAt ?? b.createdAt) || roomTs.get(b.runId) || 0;
      // 无时间戳的条目垫底（与 projects-section/artifacts-section 同款语义）
      if (!ta && !tb) return a.name.localeCompare(b.name, 'en');
      if (!ta) return 1;
      if (!tb) return -1;
      return projSort === 'time_desc' ? tb - ta : ta - tb;
    });
    return list;
  }, [board.projects, projSort, roomTs]);

  // Atomically consume the pending project deep-link (HITL inbox card). The
  // task board now owns the project view, so a deep link targets a project in
  // this section rather than the removed standalone projects section.
  //
  // Implemented as a mount-only effect (not "consumed during render") so the
  // side-effecting setView / setSelectedProjectId calls happen OUTSIDE of
  // React's render phase. Doing this in the render body of an AnimatePresence
  // child was fine in isolation but reacted to "Cannot update a component
  // while rendering a different component" when the dashboard shell (the
  // section guard effect at agent-teams-dashboard line 151-178) re-rendered
  // concurrently, and tripped the task section into an empty render that
  // looked like "first click on 任务看板 doesn't switch". The mount-only
  // effect solves both: store mutation happens post-commit, and any pending
  // key only fires on the first mount of TasksSection (mount-only deps).
  useEffect(() => {
    const pendingProjectKey = useHitlInboxStore.getState().takePendingProjectKey();
    if (pendingProjectKey?.id) {
      setView('projects');
      setSelectedProjectId(pendingProjectKey.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The board owns both project and task detail links. Read them on mount and
  // on hash changes to support navigation while the board is already open.
  useEffect(() => {
    const applyTaskBoardParams = () => {
      const path = window.location.hash.replace(/^#/, '').split('?')[0];
      if (path !== 'workbench/tasks') return;
      const params = currentHashParams();
      const taskId = params?.get('task');
      if (taskId) {
        const team = params?.get('team') || undefined;
        setSelectedTaskKey(current => current?.id === taskId && current.team === team ? current : { id: taskId, team });
      }
      const projectId = params?.get('project');
      if (!projectId) return;
      setView('projects');
      setSelectedProjectId(projectId);
    };
    applyTaskBoardParams();
    window.addEventListener('hashchange', applyTaskBoardParams);
    return () => window.removeEventListener('hashchange', applyTaskBoardParams);
  }, [setView, setSelectedProjectId]);

  const handleReload = useCallback(() => {
    clearTasks();
    setReloadKey((k) => k + 1);
    board.refetch();
  }, [clearTasks, board]);

  // Auto-select the first project: derive the effective selection instead of
  // syncing state in an effect, so the first project shows until the user
  // picks one explicitly.
  const effectiveProjectId = selectedProjectId ?? board.projects[0]?.runId ?? null;

  // 恢复的选中项目若已不在看板（项目被删/改名），清除持久化值——否则每次
  // 刷新都会闪现第一个项目再兜底，脏 id 还会被反复重新持久化。等 board 有
  // 数据再判定（加载中 projects 为空，不误清合法存储值；见
  // task-selectors.isStaleProjectSelection）。
  useEffect(() => {
    if (isStaleProjectSelection(selectedProjectId, board.projects.map((p) => p.runId))) {
      setSelectedProjectId(null);
    }
  }, [selectedProjectId, board.projects, setSelectedProjectId]);

  // ---- Filters ----
  const filteredTasks = useMemo(() => {
    const roots = mainTasks(board.tasks);
    if (!search) return roots;
    const q = search.toLowerCase();
    return roots.filter((root) => [root, ...subtasksOf(root, board.tasks)].some((t) => {
      if (t.title.toLowerCase().includes(q)) return true;
      if (t.runId.toLowerCase().includes(q)) return true;
      if (t.assignedTo.toLowerCase().includes(q)) return true;
      if (t.projectId?.toLowerCase().includes(q)) return true;
      return false;
    }));
  }, [board.tasks, search]);

  const tasksForProject = useCallback(
    (projectId: string) =>
      filteredTasks.filter(task => task.projectId === projectId).flatMap(task =>
        task.kind === 'project-summary' ? subtasksOf(task, board.tasks) : [task]),
    [filteredTasks, board.tasks],
  );

  // Group by status for the kanban view
  const tasksByStatus = useMemo(() => {
    const map = new Map<TaskStatus, BoardTask[]>(
      TASK_STATUS_COLUMNS.map((c) => [c.key, [] as BoardTask[]]),
    );
    for (const t of filteredTasks) {
      const list = map.get(t.status) ?? map.get('unknown')!;
      list.push(t);
    }
    return map;
  }, [filteredTasks]);

  const selectedProject = board.projects.find((p) => p.runId === effectiveProjectId);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="任务看板"
        meta={
          <div className="relative w-full min-w-0 sm:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="搜索任务"
              placeholder="搜索任务标题 / Run ID / 负责人 / 项目 ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-9"
            />
          </div>
        }
        actions={
          <div className="flex items-center gap-2">
            <ArchivedRoomsDialog onSelectRoom={openChatRoom} />
            <div className="flex items-center gap-1">
              {(['kanban', 'projects'] as const).map((v) => (
                <Button
                  key={v}
                  variant={view === v ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setView(v)}
                  onPointerEnter={event => { if (isDesktopHover(event)) setView(v); }}
                >
                  {v === 'kanban' ? (
                    <>
                      <Layers className="h-3.5 w-3.5 mr-1" />
                      看板
                    </>
                  ) : (
                    <>
                      <FolderTree className="h-3.5 w-3.5 mr-1" />
                      项目
                    </>
                  )}
                </Button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleReload}
              disabled={board.isLoading}
              title={
              apiBoard.degraded
                ? '清空 Matrix 缓存并重新拉取 MinIO 任务'
                : '清空 Matrix 实时叠加并重新拉取 Controller 项目 API'
            }
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${board.isLoading ? 'animate-spin' : ''}`} />
              刷新
            </Button>
          </div>
        }
      />

      {/* Diagnostic banner (MinIO fallback only — the API primary source
          reports its own degraded state via the projects section). */}
      {apiBoard.degraded && minioBoard.bucket && minioBoard.scannedKeys.length === 0 && !minioBoard.isLoading && (
        <Card className="glass-card border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-3 flex items-start gap-2 text-xs">
            <Database className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium text-amber-700 dark:text-amber-400">
                MinIO 暂未发现任务数据（Controller API 已降级）
              </p>
              <p className="text-muted-foreground">
                Bucket <code className="font-mono">{minioBoard.bucket}</code> · 扫描路径{' '}
                <code className="font-mono">shared/tasks/, shared/projects/, agents/*/task-history.json</code>
                {minioBoard.matchedPrefixes.length > 0 && (
                  <>
                    {' '}· 匹配:{' '}
                    <code className="font-mono">{minioBoard.matchedPrefixes.join(', ')}</code>
                  </>
                )}
              </p>
              <p className="text-muted-foreground/70">
                数据完全来自 Matrix 房间实时消息:Manager 在 Worker/Project 房间内的
                <code className="font-mono mx-1">agentteams.workflow</code>
                结构体会在实时列出现;MinIO 同步后将在持久列出现。
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* One quiet empty state instead of eight oversized empty columns. */}
      {view === 'kanban' && filteredTasks.length === 0 && <div className="rounded-xl border border-border bg-muted/10">
        <SectionEmptyState title={board.isLoading ? '正在加载任务…' : (apiBoard.degraded && minioBoard.error) ? '暂时无法读取任务' : search ? '未找到匹配任务' : '暂无任务'} description={(apiBoard.degraded && minioBoard.error) ? '请刷新重试。' : search ? '试试其他关键词。' : '与助手创建任务后，可以在这里跟进执行进度。'} />
      </div>}

      {/* Neutral columns; state color is limited to the header indicator. */}
      {view === 'kanban' && filteredTasks.length > 0 && (
        <div className="space-y-5">
          {[
            { title: '任务流程', keys: ['pending', 'assigned', 'in_progress', 'submitted', 'completed'], layout: 'grid-cols-1 md:grid-cols-3 xl:grid-cols-5' },
            { title: '需要关注', keys: ['blocked', 'revision', 'failed', ...(tasksByStatus.get('unknown')?.length ? ['unknown'] : [])], layout: 'grid-cols-1 md:grid-cols-3' },
          ].map((group) => (
            <section key={group.title} className="space-y-3" aria-label={group.title}>
              <h3 className="text-sm font-medium text-muted-foreground">{group.title}</h3>
              <div className={`grid items-start gap-4 ${group.layout}`}>
          {group.keys.map((key) => TASK_STATUS_COLUMNS.find((col) => col.key === key)!).map((col) => {
            const list = tasksByStatus.get(col.key) ?? [];
            return (
              <div
                key={col.key}
                className="flex h-[360px] min-w-0 flex-col gap-3 overflow-hidden rounded-xl border border-border bg-muted/10 p-3"
              >
                <div className="-mx-3 -mt-3 flex items-center gap-2 border-b border-border bg-background px-3 py-3 text-foreground">
                  <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: taskStatus(col.key).color }} />
                  <p data-task-column-title className="font-semibold">{taskStatus(col.key).label}</p>
                  <span className="ml-auto rounded-md bg-background px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{list.length}</span>
                </div>
                <div className="relative min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain custom-scrollbar">
                  <AnimatePresence initial={false} mode="popLayout">
                    {list.length === 0 ? (
                      <p key="empty" className="py-4 text-center text-xs text-muted-foreground/70">
                        暂无任务
                      </p>
                    ) : (
                      list.map((t) => {
                        const mgr = findManagerByMatrixId(managers ?? [], t.assignedTo);
                        const wk = findWorkerByName(workers ?? [], t.assignedTo);
                        return (
                          <motion.div
                            key={t.runId}
                            layout={reduceMotion ? false : 'position'}
                            initial={{ opacity: 0, y: reduceMotion ? 0 : 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
                            transition={{ duration: reduceMotion ? 0 : 0.16 }}
                          >
                            <TaskCard
                              task={t}
                              tasks={board.tasks}
                              project={board.projects.find(project => project.runId === t.projectId)}
                              managerName={mgr}
                              workerTeam={wk?.team}
                              highlightProjectId={effectiveProjectId ?? undefined}
                              selected={selectedTask === t}
                              showStatus={false}
                              onClick={() => selectTask(t)}
                            />
                          </motion.div>
                        );
                      })
                    )}
                  </AnimatePresence>
                </div>
              </div>
            );
          })}
              </div>
            </section>
          ))}
        </div>
      )}

      <TaskDetailSheet task={selectedTask} tasks={boardSelection ? board.tasks : primary.tasks} onSelectTask={selectTask} teamId={selectedTask?.teamId ?? board.projects.find(project => project.runId === selectedTask?.projectId)?.teamId} onClose={closeTask} onOpenProject={() => {
        if (selectedTask?.projectId) { setSelectedProjectId(selectedTask.projectId); setView('projects'); closeTask(); }
      }} />

      {/* View: Projects (cards + selected project plan)
          9/17 装验反馈 G4：row 容器固定撑满剩余屏高（round-4 同 220px
          顶部偏移常量）——双栏各自内部滚动，滚到底不再带着整页往下滚
          （overscroll-contain 双保险）。
          9/17 验收第六轮：补 lg:grid-rows-[minmax(0,1fr)]——只给容器固定
          高度时隐式行仍是 auto 轨道，子元素 h-full 百分比对 auto 轨道
          解析失败（退化为内容高度），右栏 scroller 因此没有约束高度=
          不可滚动（上一装验轮反馈「右边无法滚动」根因）。minmax(0,1fr)
          让唯一行=容器全高（定高），h-full 链才逐级成立。 */}
      {view === 'projects' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:h-[calc(100vh-220px)] lg:grid-rows-[minmax(0,1fr)]">
          <div className="lg:col-span-1 space-y-3 lg:h-full lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
            {board.projects.length === 0 ? (
              <Card className="glass-card">
                <CardContent className="p-0">
                  <SectionEmptyState
                    icon={FolderTree}
                    title="暂无项目"
                    description="Manager 创建项目后会写入 shared/projects/{id}/meta.json"
                  />
                </CardContent>
              </Card>
            ) : (
              <Card className="glass-card">
                <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    选择项目（已显示 {board.projects.length} / 共 {projectTotal}）
                  </p>
                  <Select
                    value={projSort}
                    onValueChange={(v) =>
                      setProjSort(v as 'time_desc' | 'time_asc' | 'name')
                    }
                  >
                    <SelectTrigger className="h-7 w-auto min-w-[108px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="time_desc">时间 新→旧</SelectItem>
                      <SelectItem value="time_asc">时间 旧→新</SelectItem>
                      <SelectItem value="name">名称</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* 左栏独立滚动（9/16 装验反馈：左栏列表要独立滚动条） */}
                <div className="max-h-[calc(100vh-220px)] min-h-[120px] space-y-2 overflow-y-auto p-3">
                  {sortedProjects.map((p) => (
                    <ProjectCard
                      key={p.runId}
                      project={p}
                      tasks={tasksForProject(p.runId)}
                      onSelect={setSelectedProjectId}
                      selected={p.runId === effectiveProjectId}
                      onMetaSaved={() => board.refetch()}
                    />
                  ))}
                  {hasMoreProjects && loadMoreProjects && (
                    <Button variant="outline" size="sm" className="w-full"
                      disabled={isWorkflowsLoading || board.isLoading}
                      onClick={loadMoreProjects}>
                      {isWorkflowsLoading ? '项目数据加载中…' : '加载更多项目（每批 20 个）'}
                    </Button>
                  )}
                  {!hasMoreProjects && projectTotal > board.projects.length && (
                    <p role="status" className="text-xs text-amber-600 dark:text-amber-400">
                      项目列表已截断：服务端 total 为 {projectTotal}，当前仅返回 {board.projects.length} 个项目。
                    </p>
                  )}
                </div>
              </Card>
            )}
          </div>
          <div className="lg:col-span-2 lg:h-full">
            {selectedProject ? (
              <Card className="glass-card lg:h-full lg:min-h-0">
                {/* G4（9/17 装验反馈）：row 已固定撑满屏高 → 右栏详情
                    直接 h-full 顶满行高（Card py-6 自带上下留白），
                    内部滚动 + overscroll-contain 止滚轮连锁。移动端
                    保持旧 max-h（无固定行高）。 */}
                <div className="max-h-[calc(100vh-260px)] lg:max-h-none lg:h-full overflow-y-auto overscroll-contain">
                <CardContent className="p-5 space-y-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-semibold">{selectedProject.name}</h3>
                      <ProjectStatusBadge status={selectedProject.status} />
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">
                      {selectedProject.runId}
                    </p>
                    {selectedProject.roomId && (
                      <button
                        type="button"
                        onClick={() => openChatRoom(selectedProject.roomId)}
                        title="打开该项目的协作空间会话"
                        className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        <MessageSquare className="h-3 w-3" />
                        <span className="font-mono underline decoration-dotted underline-offset-2">
                          {selectedProject.roomId}
                        </span>
                      </button>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-2">执行计划</p>
                    <ProjectPlanPreview project={selectedProject} />
                  </div>
                  <ProjectDagView
                    project={selectedProject}
                    tasks={tasksForProject(selectedProject.runId)}
                  />
                  {selectedProject.source === 'api' ? (
                    <div className="space-y-4"><section aria-label="项目主任务" className="space-y-2"><h4 className="text-sm font-medium">项目任务（{tasksForProject(selectedProject.runId).length}）</h4><div className="grid grid-cols-1 gap-2 md:grid-cols-2">{tasksForProject(selectedProject.runId).map(task => <TaskCard key={task.runId} task={task} tasks={board.tasks} project={selectedProject} onClick={() => selectTask(task)} />)}</div></section><details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm text-muted-foreground">项目管理与完整执行记录</summary><div className="mt-4"><WorkflowDetail
                      projectId={selectedProject.runId}
                      teamId={selectedProject.teamId}
                    /></div></details></div>
                  ) : (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2">
                        主任务 ({tasksForProject(selectedProject.runId).length})
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {tasksForProject(selectedProject.runId).map((t) => (
                          <TaskCard key={t.runId} task={t} tasks={board.tasks} project={selectedProject} onClick={() => selectTask(t)} />
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
                </div>
              </Card>
            ) : (
              <Card className="glass-card">
                <CardContent className="p-8 text-center">
                  <Sparkles className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">从左侧选择一个项目查看详情</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Not-logged-in fallback */}
      {!matrixLoggedIn && (
        <Card className="glass-card">
          <CardContent className="p-12 text-center">
            <ListTodo className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-sm font-medium">尚未登录 Matrix</p>
            <p className="text-xs text-muted-foreground mt-1">
              登录后可看到 Manager / Worker 实时工作汇报
            </p>
            <Button
              variant="default"
              size="sm"
              className="mt-4"
              onClick={() => setActiveSection('chat')}
            >
              <MessageSquare className="h-3.5 w-3.5 mr-1" />
              前往聊天登录
            </Button>
          </CardContent>
        </Card>
      )}

      <div data-reload-key={reloadKey} hidden />
    </div>
  );
}
