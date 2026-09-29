'use client';

import { useState } from 'react';
import { GitBranch, CircleAlert, Loader2, RefreshCw, Pause, Play, Map as MapIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  useProjectWorkflow,
  usePauseProject,
  useResumeProject,
  useReplanProject,
} from '@/hooks/use-projects';
import { ApiError } from '@/lib/api-error';
import type { WorkflowNodeStatus } from '@/lib/agentteams-projects-api';
import { ProjectTimelinePanel } from '../project-timeline-panel';
import { ProjectEventsPanel } from '../project-events-panel';
import {
  NODE_STATUS_COLOR,
  NODE_STATUS_LABEL,
  normalizeNodeStatus,
  toastMutationError,
} from './workflow-config';
import { ProjectStatusBadge } from './status-views';
import { TaskDetailRow } from './task-detail';

// ----- Workflow detail panel -----

// Exported so the task board's project view can embed the governance panel
// (pause / resume / replan / cancel / artifacts / timeline) for a selected
// project. Internal helpers (TaskDetailRow, CancelTaskButton, ...) stay
// module-private; only the panel itself crosses module boundaries.
export function WorkflowDetail({
  projectId,
  teamId,
}: {
  projectId: string;
  teamId?: string;
}) {
  const { data: wf, isLoading, isError, error, refetch, isRefetching } = useProjectWorkflow(
    projectId,
    teamId,
  );
  const pauseMutation = usePauseProject();
  const resumeMutation = useResumeProject();
  const replanMutation = useReplanProject();

  // Pause dialog (reason) + replan dialog (JSON tasks) local state.
  const [pauseOpen, setPauseOpen] = useState(false);
  const [pauseReason, setPauseReason] = useState('');
  const [replanOpen, setReplanOpen] = useState(false);
  const [replanText, setReplanText] = useState('');

  const mutationTeamId = teamId ?? wf?.team_id;

  const handlePause = () => {
    pauseMutation.mutate(
      { projectId, teamId: mutationTeamId, reason: pauseReason.trim() || undefined },
      {
        onSuccess: () => {
          setPauseOpen(false);
          setPauseReason('');
          toast.success('项目已暂停', { description: '团队已收到暂停通知' });
        },
        onError: (err) => toastMutationError('暂停', err),
      },
    );
  };

  const handleResume = () => {
    resumeMutation.mutate(
      { projectId, teamId: mutationTeamId },
      {
        onSuccess: () => toast.success('项目已恢复', { description: '任务继续执行' }),
        onError: (err) => toastMutationError('恢复', err),
      },
    );
  };

  const handleReplan = () => {
    let tasks: unknown[];
    try {
      const parsed = JSON.parse(replanText.trim());
      if (!Array.isArray(parsed)) {
        throw new Error('必须是 tasks 数组（JSON）');
      }
      tasks = parsed;
    } catch (parseErr) {
      toast.error('JSON 解析失败', {
        description: parseErr instanceof Error ? parseErr.message : String(parseErr),
      });
      return;
    }
    replanMutation.mutate(
      { projectId, teamId: mutationTeamId, tasks },
      {
        onSuccess: () => {
          setReplanOpen(false);
          setReplanText('');
          toast.success('项目已重规划', { description: '新 DAG 已生效' });
        },
        onError: (err) => toastMutationError('重规划', err),
      },
    );
  };

  const openReplanDialog = () => {
    // Seed the editor with the current graph so adjustments are easy.
    // tasks_detail has no depends_on field — rebuild dependencies from the
    // workflow edges (edge source -> target means target depends on source)
    // so submitting the seed verbatim preserves the original DAG.
    const dependsOf = new Map<string, string[]>();
    for (const edge of wf?.edges ?? []) {
      const list = dependsOf.get(edge.target) ?? [];
      list.push(edge.source);
      dependsOf.set(edge.target, list);
    }
    const current = (wf?.tasks_detail ?? []).map((t) => ({
      taskId: t.task_id,
      title: t.summary ?? t.task_id,
      ...(t.assigned_to ? { assignedTo: t.assigned_to } : {}),
      // status deliberately omitted: the controller preserves the previous
      // status when a task id already exists (and defaults to planned) —
      // an explicit status here would override in-flight/completed states
      // and pollute the new plan.
      ...((dependsOf.get(t.task_id)?.length ?? 0) > 0
        ? { dependsOn: dependsOf.get(t.task_id) }
        : {}),
    }));
    setReplanText(JSON.stringify(current, null, 2));
    setReplanOpen(true);
  };

  const resumeInterrupt = wf?.interrupts.find(
    (it) => it.action_request?.action === 'resume' && it.config?.allow_accept,
  );

  const canPause = wf && (wf.status === 'active' || wf.status === 'planning');
  const canReplan = wf && wf.status === 'active' && (wf.plan_type ?? 'dag') === 'dag';

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground text-sm gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> 加载工作流…
      </div>
    );
  }

  if (isError || !wf) {
    // 409 = 同一 project_id 在多个团队存在（(team, project_id) 复合身份），
    // 单独提示而非笼统的"不可用"。
    const ambiguous =
      error instanceof ApiError && error.status === 409;
    return (
      <div className="text-center py-10 text-muted-foreground text-sm space-y-1">
        {ambiguous ? (
          <>
            <p>该项目 id 在多个团队下存在（Controller 返回 409）。</p>
            <p className="text-xs">
              请从左侧选择带正确团队标签的条目重试；若列表只显示一条，请在
              Controller 侧核对 project meta 的 team 归属。
            </p>
          </>
        ) : (
          <p>无法加载项目工作流（项目不存在或 API 不可用）</p>
        )}
      </div>
    );
  }

  const taskCount = wf.values?.task_count ?? {};
  const statuses = Object.entries(taskCount);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <GitBranch className="h-4 w-4" />
          {wf.title}
          <ProjectStatusBadge status={wf.status} />
        </h3>
        <div className="flex items-center gap-1">
          {canPause && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPauseOpen(true)}
              disabled={pauseMutation.isPending}
              className="text-xs"
            >
              <Pause className="h-3.5 w-3.5 mr-1" />
              暂停
            </Button>
          )}
          {canReplan && (
            <Button
              variant="outline"
              size="sm"
              onClick={openReplanDialog}
              disabled={replanMutation.isPending}
              className="text-xs"
            >
              <MapIcon className="h-3.5 w-3.5 mr-1" />
              重规划
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Pause dialog: optional reason (POST .../pause) */}
      <Dialog open={pauseOpen} onOpenChange={setPauseOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>暂停项目</DialogTitle>
            <DialogDescription>
              暂停后任务停止派发，团队会收到暂停通知。可在中断卡处随时恢复。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={pauseReason}
            onChange={(e) => setPauseReason(e.target.value)}
            placeholder="暂停原因（可选，将通知团队）"
            rows={3}
            className="text-sm"
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setPauseOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={handlePause}
              disabled={pauseMutation.isPending}
            >
              {pauseMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              确认暂停
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Replan dialog: JSON tasks payload (POST .../replan) */}
      <Dialog open={replanOpen} onOpenChange={setReplanOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>重规划 DAG</DialogTitle>
            <DialogDescription>
              粘贴新任务图（tasks 数组：taskId/title/assignedTo/dependsOn/status）。
              Controller 校验重复任务、未知依赖与环。有任务执行中时会被 409 拒绝。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={replanText}
            onChange={(e) => setReplanText(e.target.value)}
            placeholder='[{"taskId":"t1","title":"任务一","dependsOn":[]}]'
            rows={10}
            className="font-mono text-xs"
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setReplanOpen(false)}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleReplan}
              disabled={replanMutation.isPending}
            >
              {replanMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              提交重规划
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {wf.team_id && (
        <p className="text-xs text-muted-foreground">
          {wf.team_id ? `团队 ${wf.team_id} · ` : ''}
          {wf.mode ?? 'project'} · {wf.plan_type ?? 'dag'}
          {wf.source ? ` · 来源 ${wf.source}` : ''}
        </p>
      )}

      {/* Interrupts (paused project surfaces action_request resume) */}
      {wf.interrupts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground">中断</p>
          {wf.pause_reason && (
            <p className="text-xs text-orange-700 dark:text-orange-400">
              暂停原因：{wf.pause_reason}
            </p>
          )}
          {wf.interrupts.map((it) => (
            <div
              key={it.id}
              className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-2.5 text-xs"
            >
              <p className="font-medium text-orange-700 dark:text-orange-400 flex items-center gap-1.5">
                <CircleAlert className="h-3.5 w-3.5" />
                {it.value}
                {it.description && <span className="font-normal opacity-75">— {it.description}</span>}
              </p>
              {it.action_request && (
                <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                  action: {it.action_request.action}
                  {it.config?.allow_accept ? ' · 可接受(恢复)' : ''}
                </p>
              )}
              {it === resumeInterrupt && (
                <Button
                  size="sm"
                  className="mt-1.5 text-xs"
                  onClick={handleResume}
                  disabled={resumeMutation.isPending}
                >
                  {resumeMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5 mr-1" />
                  )}
                  恢复执行
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Loop progress */}
      {wf.loop && (
        <div className="rounded-lg border p-2.5 text-xs space-y-1">
          <p className="font-semibold text-muted-foreground">
            Loop 进度
            {wf.loop.status && <span className="ml-2 font-normal opacity-75">{wf.loop.status}</span>}
          </p>
          {typeof wf.loop.current_iteration === 'number' &&
            typeof wf.loop.max_iterations === 'number' && (
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-violet-500/70"
                    style={{
                      width: `${Math.min(100, (wf.loop.current_iteration / Math.max(1, wf.loop.max_iterations)) * 100)}%`,
                    }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {wf.loop.current_iteration}/{wf.loop.max_iterations}
                </span>
              </div>
            )}
          {wf.loop.goal && <p className="text-muted-foreground pt-1">{wf.loop.goal}</p>}
          {wf.loop.tasks && wf.loop.tasks.length > 0 && (
            <div className="pt-2 space-y-1">
              {wf.loop.tasks.map((t) => (
                <div key={t.task_id} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-[10px] text-muted-foreground">{t.task_id}</span>
                  <span className="truncate">{t.title}</span>
                  {t.assigned_to && <span className="text-[10px] text-muted-foreground">{t.assigned_to}</span>}
                  {t.status && (
                    <Badge className={`text-[10px] border ${NODE_STATUS_COLOR[normalizeNodeStatus(t.status)]}`}>
                      {NODE_STATUS_LABEL[normalizeNodeStatus(t.status)]}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Next runnable tasks (next: 依赖全完成、当前可执行) */}
      {wf.next.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1.5">
            下一步（{wf.next.length}）
          </p>
          <div className="flex flex-wrap gap-1.5">
            {wf.next.map((taskId) => {
              const node = wf.nodes.find((n) => n.id === taskId);
              return (
                <Badge
                  key={taskId}
                  className="text-[10px] border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                >
                  {node?.name ?? taskId}
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      {/* Task count distribution */}
      {statuses.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1.5">任务分布</p>
          <div className="flex flex-wrap gap-1.5">
            {statuses.map(([status, count]) => (
              <Badge key={status} className={`text-[10px] border ${NODE_STATUS_COLOR[status as WorkflowNodeStatus] ?? ''}`}>
                {NODE_STATUS_LABEL[status as WorkflowNodeStatus] ?? status}: {count}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Task details (includeTasks → tasks_detail + artifact download) */}
      {wf.tasks_detail && wf.tasks_detail.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1.5">
            任务详情（{wf.tasks_detail.length}）
          </p>
          <div className="space-y-1.5">
            {wf.tasks_detail.map((t) => (
              <TaskDetailRow
                key={t.task_id}
                task={t}
                projectId={wf.project_id}
                teamId={mutationTeamId}
              />
            ))}
          </div>
        </div>
      )}

      {/* Intervention timeline (controller history endpoint) */}
      <ProjectTimelinePanel projectId={wf.project_id} teamId={mutationTeamId} />

      {/* Task-transition event stream (controller /events, upstream #1233) */}
      <ProjectEventsPanel projectId={wf.project_id} teamId={mutationTeamId} />

      {/* Nodes */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-1.5">
          节点（{wf.nodes.length}）
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
          {wf.nodes.map((n) => (
            <div key={n.id} className="rounded-lg border bg-background/40 p-2 text-xs flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{n.name}</p>
                <p className="text-[10px] text-muted-foreground font-mono truncate">{n.id}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {n.assignee && <span className="text-[10px] text-muted-foreground">{n.assignee}</span>}
                <Badge className={`text-[10px] border ${NODE_STATUS_COLOR[n.status] ?? ''}`}>
                  {NODE_STATUS_LABEL[n.status] ?? n.status}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
