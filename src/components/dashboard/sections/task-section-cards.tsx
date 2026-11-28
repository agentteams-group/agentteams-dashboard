'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Clock,
  Crown,
  GitBranch,
  Layers,
  ListTodo,
  Loader2,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { OverflowText } from '@/components/dashboard/overflow-text';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { useRoomMetaStore } from '@/hooks/use-matrix';
import { buildProjectDag } from '@/lib/project-dag';
import { PROJECT_STATUS_COLOR } from '@/lib/status-colors';
import { INTERACTIVE_CARD_CLASS, handleActivate } from '@/lib/interaction-states';
import { subtasksOf } from '@/lib/task-hierarchy';
import type { BoardProject, BoardTask, PlanItem, ProjectStatus } from '@/hooks/use-task-board';
import { ProjectDagSvg } from '@/components/dashboard/project-dag-svg';
import { MetaEditorEntry } from './projects/meta-editor';
import {
  DAG_NODE_FILL,
  PROJECT_STATUS_LABEL,
  OutcomeBadge,
  StatusBadge,
  SubtaskProgress,
  TaskDependencies,
  TaskRoomActions,
  taskMetaQuery,
} from './task-detail-sheet';

const MARKER_LABEL: Record<string, string> = {
  ' ': '待办',
  '~': '进行中',
  x: '完成',
  '!': '阻塞',
  '→': '需修订',
};

function shortId(id: string, head = 14): string {
  if (id.length <= head) return id;
  return `${id.slice(0, head)}…`;
}

function displayTime(epochMs: number): string {
  if (!epochMs) return '—';
  const d = new Date(epochMs);
  const now = Date.now();
  const diff = now - epochMs;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export function findManagerByMatrixId(
  managers: { name: string; matrixUserID?: string }[],
  sender: string,
): string | undefined {
  if (!sender) return undefined;
  return managers.find((m) => m.matrixUserID === sender)?.name;
}

export function findWorkerByName(
  workers: { name: string; matrixUserID?: string; team?: string }[],
  name: string,
): { name: string; matrixUserID: string; team: string } | undefined {
  if (!name) return undefined;
  const exact = workers.find((w) => w.name === name);
  if (exact) return { name: exact.name, matrixUserID: exact.matrixUserID || '', team: exact.team || '' };
  const byMatrix = workers.find((w) => w.matrixUserID === name);
  if (byMatrix) return { name: byMatrix.name, matrixUserID: byMatrix.matrixUserID || '', team: byMatrix.team || '' };
  return undefined;
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge className={`text-xs border ${PROJECT_STATUS_COLOR[status]}`}>
      {PROJECT_STATUS_LABEL[status]}
    </Badge>
  );
}

function TaskPreview({ task, tasks, project, team, onOpenDetails }: { task: BoardTask; tasks: BoardTask[]; project?: BoardProject; team?: string; onOpenDetails?: () => void }) {
  const children = subtasksOf(task, tasks);
  const detail = useQuery({
    ...taskMetaQuery(task.runId, task.teamId),
    enabled: children.length === 0 && (task.status !== 'pending' || !!task.executionRoomId),
    retry: false,
  });
  const sourceName = useRoomMetaStore(state => state.meta[task.roomId]?.roomName);
  const latestProgress = detail.data?.history?.findLast(event => event.action === 'report_progress' && event.note)?.note;
  const created = task.createdAt || (detail.data?.created_at ? new Date(detail.data.created_at).getTime() : 0);
  return <div className="space-y-2">
    <div className="space-y-2 pr-6"><StatusBadge status={task.status} /><h3 className="text-sm font-semibold leading-6">{task.title}</h3></div>
    <SubtaskProgress task={task} tasks={tasks} />
    <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
      <dt className="text-muted-foreground">创建时间</dt><dd>{created > 0 ? new Date(created).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '暂未提供'}</dd>
      <dt className="text-muted-foreground">负责团队</dt><dd className="break-words">{team || task.teamId || '未指定'}</dd>
      <dt className="text-muted-foreground">{children.length ? '负责人' : 'Worker 成员'}</dt><dd>{task.assignedTo || (children.length ? '团队 Leader 协调' : '未分配')}</dd>
      <dt className="text-muted-foreground">来源会话</dt><dd className="truncate" title={task.roomId}>{sourceName || task.roomId || '暂无来源会话'}</dd>
    </dl>
    {children.length === 0 && <section className="space-y-2 rounded-lg bg-muted/40 p-3"><h4 className="text-xs font-medium">当前进展</h4>
      <p className="line-clamp-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{latestProgress || detail.data?.result_summary || detail.data?.summary || '暂无进展说明'}</p>
      {detail.isLoading && <p role="status" className="text-xs text-muted-foreground">正在加载详情…</p>}
      {detail.isError && <p role="status" className="text-xs text-muted-foreground">详情暂时无法读取<Button variant="ghost" size="sm" onClick={() => void detail.refetch()}>重试</Button></p>}
    </section>}
    <TaskDependencies task={task} tasks={tasks} project={project} />
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3"><TaskRoomActions task={task} tasks={tasks} />{onOpenDetails && <Button variant="ghost" size="sm" className="text-xs" onClick={onOpenDetails}>查看完整详情</Button>}</div>
  </div>;
}

function PlanItemRow({ item }: { item: PlanItem }) {
  const markerChar = item.marker.replace(/[[\]]/g, '');
  const color =
    item.done
      ? 'text-emerald-500 line-through opacity-60'
      : item.inProgress
        ? 'text-violet-500'
        : item.blocked
          ? 'text-red-500'
          : 'text-muted-foreground';
  return (
    <div className="flex items-start gap-2 text-xs">
      <span
        className={`shrink-0 font-mono w-4 text-center ${color}`}
        title={MARKER_LABEL[markerChar] ?? markerChar}
      >
        {item.marker}
      </span>
      <div className="flex-1 min-w-0">
        <span className={item.done ? 'line-through opacity-70' : ''}>{item.text}</span>
        {item.owner && (
          <span className="ml-2 text-muted-foreground">@ {item.owner}</span>
        )}
        {item.taskId && (
          <span className="ml-2 text-muted-foreground/70 font-mono">
            ({shortId(item.taskId, 18)})
          </span>
        )}
      </div>
    </div>
  );
}

export function TaskCard({
  task,
  managerName,
  workerTeam,
  highlightProjectId,
  selected,
  showStatus = true,
  onClick,
  tasks = [],
  project,
}: {
  task: BoardTask;
  managerName?: string;
  workerTeam?: string;
  highlightProjectId?: string;
  selected?: boolean;
  showStatus?: boolean;
  onClick?: () => void;
  tasks?: BoardTask[];
  project?: BoardProject;
}) {
  const expanded = selected ?? (highlightProjectId === task.projectId);
  const [previewOpen, setPreviewOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTitle = useId();
  const clearTimer = () => { if (timer.current) clearTimeout(timer.current); };
  const changePreview = (open: boolean) => { clearTimer(); setPreviewOpen(open); };
  const schedulePreview = (open: boolean) => { clearTimer(); timer.current = setTimeout(() => setPreviewOpen(open), open ? 250 : 200); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const openDetails = () => { changePreview(false); onClick?.(); };
  return (
    <Popover open={previewOpen} onOpenChange={changePreview}>
    <PopoverAnchor asChild>
    <Card
      onPointerEnter={event => { if (event.pointerType !== 'touch') schedulePreview(true); }}
      onPointerLeave={() => schedulePreview(false)}
      onFocus={event => { if (event.target === event.currentTarget) changePreview(true); }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) schedulePreview(false); }}
      {...(onClick
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-pressed': expanded,
            onClick: openDetails,
            onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => { if (event.key === 'Escape') changePreview(false); else handleActivate(openDetails)(event); },
          }
        : {})}
      className={`gap-0 rounded-lg border bg-card py-0 shadow-none ${onClick ? INTERACTIVE_CARD_CLASS : 'transition-colors hover:border-foreground/20'} ${expanded ? 'border-primary/35' : 'border-border'}`}
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-2">
          <OverflowText text={task.title} multiline className="min-w-0 flex-1 text-sm font-medium leading-6" />
          {task.kind === 'project-summary' && <Badge variant="outline">项目</Badge>}
          {!showStatus && task.status === 'in_progress' && <Loader2 aria-label="任务正在执行" className="mt-1 size-3.5 shrink-0 text-status-running motion-safe:animate-spin" />}
        </div>
        <SubtaskProgress task={task} tasks={tasks} />
        {(showStatus || task.outcome || task.dependsOn.length > 0) && <div className="flex items-start gap-2">
          {showStatus && <StatusBadge status={task.status} />}
          {task.outcome && <OutcomeBadge outcome={task.outcome} />}
          {task.dependsOn.length > 0 && (
            <Badge
              variant="outline"
              className="text-xs gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400"
              title={`依赖 ${task.dependsOn.length} 个前置任务`}
            >
              依赖 {task.dependsOn.length}
            </Badge>
          )}
        </div>}
        {task.title !== task.runId && <p className="text-xs text-muted-foreground font-mono" title={task.runId}>
          {shortId(task.runId, 22)}
        </p>}
        <div className="min-w-0 space-y-1.5 text-xs text-muted-foreground">
          {task.assignedTo && (
            <div className="min-w-0" title={task.assignedTo}>
              <OverflowText text={managerName || task.assignedTo.replace(/^@([^:]+):.*$/, '$1')} />
              {workerTeam && <OverflowText text={workerTeam} className="mt-1 text-muted-foreground/70" />}
            </div>
          )}
          {task.createdAt > 0 && <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {displayTime(task.createdAt)}
          </span>}
        </div>
        <TaskRoomActions task={task} tasks={tasks} compact />
      </CardContent>
    </Card>
    </PopoverAnchor>
    <PopoverContent side="right" align="start" sideOffset={10} collisionPadding={16} className="w-[600px] max-w-[calc(100vw-32px)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-xl p-4 shadow-lg" aria-labelledby={previewTitle}
      onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
      onPointerEnter={clearTimer} onPointerLeave={() => schedulePreview(false)} onFocus={clearTimer} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) schedulePreview(false); }}>
      <span id={previewTitle} className="sr-only">任务预览：{task.title}</span>
      {previewOpen && <TaskPreview task={task} tasks={tasks} project={project} team={workerTeam} onOpenDetails={openDetails} />}
    </PopoverContent>
    </Popover>
  );
}

export function ProjectCard({
  project,
  tasks,
  onSelect,
  selected,
  onMetaSaved,
}: {
  project: BoardProject;
  tasks: BoardTask[];
  onSelect: (_id: string) => void;
  selected: boolean;
  onMetaSaved?: () => void;
}) {
  const allItems = project.phases.flatMap((p) => p.items);
  const done = allItems.length ? allItems.filter((i) => i.done).length : tasks.filter(task => task.status === 'completed').length;
  const total = allItems.length || tasks.length;
  const inProgress = allItems.filter((i) => i.inProgress).length;
  const blocked = allItems.filter((i) => i.blocked).length;
  const progressPct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onSelect(project.runId)}
      onKeyDown={handleActivate(() => onSelect(project.runId))}
      className={`glass-card ${INTERACTIVE_CARD_CLASS} ${
        selected ? 'border-violet-500/50 ring-1 ring-violet-500/30' : ''
      }`}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-2 flex-wrap">
          <ProjectStatusBadge status={project.status} />
          <Badge variant="outline" className="text-xs gap-1">
            <Layers className="h-2.5 w-2.5" />
            {project.phases.length} 阶段
          </Badge>
          <Badge variant="outline" className="text-xs gap-1">
            <ListTodo className="h-2.5 w-2.5" />
            {tasks.length} 任务
          </Badge>
        </div>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold">{project.name}</p>
            {/* 项目 meta 编辑入口（仅 Controller API 项目有 meta 端点；
                405/404 → 入口自隐藏） */}
            {project.source === 'api' && (
              <MetaEditorEntry
                kind="project"
                id={project.runId}
                title={project.name}
                teamId={project.teamId}
                onSaved={onMetaSaved}
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            {project.runId}
          </p>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{allItems.length ? '计划进度' : '任务进度'}</span>
            <span>
              {done}/{total} · {progressPct}%
            </span>
          </div>
          <Progress value={progressPct} className="h-1.5" />
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          {project.leader && (
            <span className="flex items-center gap-1">
              <Crown className="h-3 w-3" />
              {project.leader}
            </span>
          )}
          {project.workers.length > 0 && (
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {project.workers.length} Worker
            </span>
          )}
          {inProgress > 0 && (
            <span className="flex items-center gap-1 text-violet-600 dark:text-violet-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              {inProgress} 进行中
            </span>
          )}
          {blocked > 0 && (
            <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-3 w-3" />
              {blocked} 阻塞
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function ProjectPlanPreview({ project }: { project: BoardProject }) {
  const allItems = project.phases.flatMap((p) => p.items);
  if (allItems.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        该项目暂无 plan.md 计划阶段
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {project.phases.map((phase, i) => (
        <div key={`${project.runId}-phase-${i}`}>
          <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1.5">
            <Layers className="h-3 w-3" />
            {phase.heading}
            <span className="text-xs text-muted-foreground/70 font-normal">
              {phase.items.filter((i) => i.done).length}/{phase.items.length}
            </span>
          </p>
          <div className="space-y-1">
            {phase.items.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">无子任务</p>
            ) : (
              phase.items.map((item, j) => (
                <PlanItemRow key={`${i}-${j}-${item.taskId ?? item.text}`} item={item} />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProjectDagView({ project, tasks }: { project: BoardProject; tasks: BoardTask[] }) {
  const dag = useMemo(
    () => buildProjectDag(tasks, project.runId),
    [tasks, project.runId],
  );

  if (dag.nodes.length === 0) return null;
  if (dag.edges.length === 0 && dag.nodes.length <= 1) {
    return (
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
          <GitBranch className="h-3 w-3" />
          依赖图
        </p>
        <p className="text-xs text-muted-foreground italic">
          该项目任务之间暂无依赖关系
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
        <GitBranch className="h-3 w-3" />
        依赖图
        <span className="text-xs text-muted-foreground/70 font-normal">
          {dag.nodes.length} 任务 · {dag.edges.length} 依赖
          {dag.externalDeps.length > 0 && ` · ${dag.externalDeps.length} 外部依赖`}
        </span>
      </p>
      <div className="rounded-lg border bg-background/40 overflow-x-auto p-2">
        <ProjectDagSvg dag={dag} nodeColors={DAG_NODE_FILL} title={`${project.name} 任务依赖图`} />
      </div>
    </div>
  );
}
