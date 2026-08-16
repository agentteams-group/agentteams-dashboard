'use client';

import { useMemo, useState } from 'react';
import { GitBranch, FolderKanban, CircleAlert, Loader2, RefreshCw, Pause, Play, Map as MapIcon, Ban, List, LayoutGrid } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
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
import { SectionHeader } from '@/components/dashboard/section-header';
import { ProjectDagSvg, type DagNodeColor } from '@/components/dashboard/project-dag-svg';
import { buildWorkflowDag } from '@/lib/project-dag';
import {
  useProjects,
  useProjectWorkflow,
  usePauseProject,
  useResumeProject,
  useReplanProject,
  useCancelProjectTask,
} from '@/hooks/use-projects';
import { ApiError } from '@/lib/api-error';
import { ProjectTimelinePanel } from './project-timeline-panel';
import {
  getTaskArtifactUrl,
  type ProjectStatus,
  type ProjectSummary,
  type WorkflowNodeStatus,
  type WorkflowTaskDetail,
} from '@/lib/agentteams-projects-api';

// ----- Status config (mirrors tasks-section colors/labels so the two
// project views on the dashboard look consistent) -----

const PROJECT_STATUS_COLOR: Record<ProjectStatus, string> = {
  planning: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  active: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  paused: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  completed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  unknown: 'bg-muted text-muted-foreground border-border',
};

// Same Chinese labels as tasks-section's PROJECT_STATUS_LABEL.
const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: '规划中',
  active: '进行中',
  paused: '已暂停',
  completed: '已完成',
  unknown: '未知',
};

const NODE_STATUS_COLOR: Record<WorkflowNodeStatus, string> = {
  pending: 'text-slate-500 bg-slate-500/10 border-slate-500/30',
  delegated: 'text-blue-500 bg-blue-500/10 border-blue-500/30',
  'in-progress': 'text-violet-500 bg-violet-500/10 border-violet-500/30',
  completed: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30',
  revision: 'text-amber-500 bg-amber-500/10 border-amber-500/30',
  blocked: 'text-red-500 bg-red-500/10 border-red-500/30',
};

// Mirrors tasks-section column labels (待办/已派发/执行中/已完成/阻塞).
const NODE_STATUS_LABEL: Record<WorkflowNodeStatus, string> = {
  pending: '待办',
  delegated: '已派发',
  'in-progress': '执行中',
  completed: '已完成',
  revision: '需修订',
  blocked: '阻塞',
};

/** Normalize a raw TaskMeta status to the frontend enum, mirroring the
 * controller's normalizeTaskStatus (project_handler.go): planned→pending,
 * assigned→delegated, in_progress/submitted→in-progress, cancelled→blocked.
 * tasks_detail and loop tasks carry the RAW status, while workflow nodes are
 * already normalized. */
function normalizeNodeStatus(raw?: string): WorkflowNodeStatus {
  switch (raw) {
    case 'planned':
    case '':
      return 'pending';
    case 'assigned':
      return 'delegated';
    case 'in_progress':
    case 'submitted':
      return 'in-progress';
    case 'completed':
      return 'completed';
    case 'revision':
      return 'revision';
    case 'blocked':
    case 'cancelled':
      return 'blocked';
    default:
      // Unknown/future controller statuses render as blocked rather than
      // "待办" — a task we don't understand should not look actionable.
      return 'blocked';
  }
}

/** SVG node colors for the workflow DAG view — same palette family as
 * NODE_STATUS_COLOR (badges) mapped to the shared ProjectDagSvg renderer. */
const WORKFLOW_NODE_FILL: Record<string, DagNodeColor> = {
  pending: { fill: 'rgba(148,163,184,0.12)', stroke: '#94a3b8', text: '#94a3b8' },
  assigned: { fill: 'rgba(59,130,246,0.14)', stroke: '#3b82f6', text: '#93c5fd' },
  in_progress: { fill: 'rgba(139,92,246,0.16)', stroke: '#8b5cf6', text: '#a78bfa' },
  completed: { fill: 'rgba(16,185,129,0.14)', stroke: '#10b981', text: '#34d399' },
  failed: { fill: 'rgba(239,68,68,0.14)', stroke: '#ef4444', text: '#f87171' },
  blocked: { fill: 'rgba(245,158,11,0.14)', stroke: '#f59e0b', text: '#fbbf24' },
  unknown: { fill: 'rgba(148,163,184,0.08)', stroke: '#64748b', text: '#94a3b8' },
};

/** Controller terminal statuses (isTerminalTaskStatus): these tasks cannot
 * be cancelled (409). cancelled itself stays cancellable but is already
 * terminal in practice, so hide the button there too. */
const UNCANCELLABLE_STATUSES = new Set(['completed', 'revision', 'blocked', 'cancelled']);

/** Cancel button for one task row (POST .../tasks/{taskId}/cancel).
 * Renders only for non-terminal tasks; opens a reason dialog. */
function CancelTaskButton({
  projectId,
  taskId,
  teamId,
}: {
  projectId: string;
  taskId: string;
  teamId?: string;
}) {
  const cancelMutation = useCancelProjectTask();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  const handleCancel = () => {
    cancelMutation.mutate(
      // Button is disabled while reason is blank; the controller also
      // 400s on an empty reason as a second line of defense.
      { projectId, taskId, teamId, reason: reason.trim() },
      {
        onSuccess: () => {
          setOpen(false);
          setReason('');
          toast.success('任务已取消', { description: '团队已收到取消通知' });
        },
        onError: (err) => toastMutationError('取消任务', err),
      },
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={cancelMutation.isPending}
        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-400 hover:bg-red-500/15 transition-colors disabled:opacity-50"
        title="取消任务"
      >
        <Ban className="h-3 w-3" />
        取消
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>取消任务</DialogTitle>
            <DialogDescription>
              任务将标记为 cancelled，团队会收到取消通知。原因必填。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="取消原因（必填）"
            rows={3}
            className="text-sm"
          />
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              关闭
            </Button>
            <Button
              size="sm"
              onClick={handleCancel}
              disabled={cancelMutation.isPending || !reason.trim()}
            >
              {cancelMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
              确认取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** One task's TaskMeta row: status/assignee/result + artifact download
 *  links (result_path + each deliverable, via the artifact proxy). */
function TaskDetailRow({
  task,
  projectId,
  teamId,
}: {
  task: WorkflowTaskDetail;
  projectId: string;
  teamId?: string;
}) {
  const deliverables = Array.isArray(task.deliverables)
    ? task.deliverables.filter((d): d is string => typeof d === 'string')
    : [];
  const cancellable =
    !!task.status && !UNCANCELLABLE_STATUSES.has(task.status);
  return (
    <div className="rounded-lg border bg-background/40 p-2 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[10px] text-muted-foreground">{task.task_id}</span>
        {task.status && (
          <Badge className={`text-[10px] border ${NODE_STATUS_COLOR[normalizeNodeStatus(task.status)]}`}>
            {NODE_STATUS_LABEL[normalizeNodeStatus(task.status)]}
          </Badge>
        )}
        {task.assigned_to && (
          <span className="text-[10px] text-muted-foreground">{task.assigned_to}</span>
        )}
        {task.result_status && (
          <span className="text-[10px] text-muted-foreground">验收：{task.result_status}</span>
        )}
        {task.summary && (
          <span className="text-muted-foreground truncate max-w-[300px]" title={task.summary}>
            {task.summary}
          </span>
        )}
        {cancellable && (
          <CancelTaskButton projectId={projectId} taskId={task.task_id} teamId={teamId} />
        )}
      </div>
      {(task.result_path || deliverables.length > 0) && (
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <span className="text-[10px] text-muted-foreground shrink-0">产物：</span>
          {task.result_path ? (
            <ArtifactLink
              href={getTaskArtifactUrl(projectId, task.task_id)}
              label="结果文件"
            />
          ) : null}
          {deliverables.map((d) => (
            <ArtifactLink
              key={d}
              href={getTaskArtifactUrl(projectId, task.task_id, d)}
              label={d.split('/').pop() || d}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ArtifactLink({ href, label }: { href: string; label: string }) {
  const [downloading, setDownloading] = useState(false);
  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch(href, { cache: 'no-store' });
      if (!res.ok) {
        // The proxy passes through the controller's JSON error body — surface
        // the real reason instead of letting the browser render it as content.
        let detail = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string; message?: string };
          if (typeof body?.message === 'string' && body.message) detail = body.message;
          else if (typeof body?.error === 'string' && body.error) detail = body.error;
        } catch {
          // non-JSON error body; keep the status
        }
        toast.error('产物下载失败', { description: detail });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = label;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error('产物下载失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDownloading(false);
    }
  };
  return (
    <button
      type="button"
      onClick={() => void handleDownload()}
      disabled={downloading}
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400 hover:bg-amber-500/15 transition-colors disabled:opacity-50"
      title={href}
    >
      <FolderKanban className="h-3 w-3" />
      {label}
    </button>
  );
}

function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge className={`text-[10px] gap-1 border ${PROJECT_STATUS_COLOR[status] ?? PROJECT_STATUS_COLOR.unknown}`}>
      {PROJECT_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

/** Surface a project mutation failure with the controller's exact reason
 * (ApiError carries the upstream status + error string, e.g. 409 "project
 * is already paused"). */
function toastMutationError(action: string, error: unknown) {
  if (error instanceof ApiError) {
    toast.error(`项目${action}失败（HTTP ${error.status}）`, { description: error.message });
  } else {
    toast.error(`项目${action}失败`, {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

// ----- Degraded banner (consumes degradedReason from the proxy) -----

function DegradedBanner({
  degraded,
  degradedReason,
  error,
}: {
  degraded?: boolean;
  degradedReason?: 'api-not-deployed' | 'controller-error';
  error?: string;
}) {
  if (!degraded) return null;
  const message =
    degradedReason === 'controller-error'
      ? 'Controller 端点存在但调用失败（可能 MinIO 不可达）'
      : 'Controller 项目 API 不可用（Controller 未升级到含项目 API 的版本）';
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400 flex items-start gap-2">
      <CircleAlert className="h-4 w-4 mt-0.5 shrink-0" />
      <div>
        <p className="font-medium">项目 API 降级</p>
        <p className="text-xs opacity-80">{message}</p>
        {error && <p className="text-xs opacity-60 mt-1 font-mono">{error}</p>}
      </div>
    </div>
  );
}

// ----- Workflow detail panel -----

function WorkflowDetail({
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

// ----- Workflow DAG view (topo) -----

function WorkflowDagView({
  projectId,
  teamId,
}: {
  projectId: string;
  teamId?: string;
}) {
  const { data: wf, isLoading, isError } = useProjectWorkflow(projectId, teamId);
  const dag = useMemo(
    () =>
      wf
        ? buildWorkflowDag(
            wf.nodes.map((n) => ({ id: n.id, name: n.name, status: n.status })),
            wf.edges.map((e) => ({ source: e.source, target: e.target })),
            wf.next,
          )
        : { nodes: [], edges: [], externalDeps: [] as string[] },
    [wf],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground text-sm gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> 加载工作流…
      </div>
    );
  }
  if (isError || !wf) {
    return (
      <p className="text-center py-10 text-muted-foreground text-sm">
        无法加载工作流（项目不存在或 API 不可用）
      </p>
    );
  }
  if (dag.nodes.length === 0) {
    return (
      <p className="text-center py-10 text-muted-foreground text-sm">
        该项目暂无任务节点
      </p>
    );
  }
  if (dag.edges.length === 0 && dag.nodes.length <= 1) {
    return (
      <p className="text-center py-10 text-muted-foreground text-sm italic">
        该项目任务之间暂无依赖关系
      </p>
    );
  }

  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
        <GitBranch className="h-3 w-3" />
        依赖图
        <span className="text-[10px] text-muted-foreground/70 font-normal">
          {dag.nodes.length} 任务 · {dag.edges.length} 依赖
          {dag.externalDeps.length > 0 && ` · ${dag.externalDeps.length} 外部依赖`}
        </span>
      </p>
      <div className="rounded-lg border bg-background/40 overflow-x-auto p-2">
        <ProjectDagSvg
          dag={dag}
          nodeColors={WORKFLOW_NODE_FILL}
          title={`${wf.title} 任务依赖图`}
        />
      </div>
    </div>
  );
}

/** (team, project_id) composite identity comparison. Accepts both
 * the selection shape ({ id, team }) and the API summary shape
 * ({ project_id, team_id }). */
function isSameProject(
  a: { project_id?: string; id?: string; team_id?: string; team?: string } | null,
  b: { project_id?: string; id?: string; team_id?: string; team?: string } | null,
): boolean {
  if (!a || !b) return false;
  return (
    (a.project_id ?? a.id ?? '') === (b.project_id ?? b.id ?? '') &&
    (a.team_id ?? a.team ?? '') === (b.team_id ?? b.team ?? '')
  );
}

// ----- Project card (card view) -----

function ProjectCard({
  project,
  selected,
  onSelect,
}: {
  project: ProjectSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-lg border p-3 text-xs transition-colors ${
        selected
          ? 'border-primary/50 bg-primary/5'
          : 'border-muted hover:bg-muted/50'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold truncate">{project.title}</span>
        <ProjectStatusBadge status={project.status} />
      </div>
      <p className="text-[10px] text-muted-foreground font-mono mt-1 truncate">
        {project.project_id}
      </p>
      <p className="text-[10px] text-muted-foreground mt-1">
        {project.team_id ? `团队 ${project.team_id} · ` : ''}
        {project.plan_type ?? 'dag'} · {project.mode ?? 'project'}
      </p>
    </button>
  );
}

// ----- Main section -----

export function ProjectsSection() {
  const { data, isLoading, isError, refetch, isRefetching } = useProjects();
  // (team, project_id) composite selection — the same project id can exist
  // under two teams (identity scoping).
  const [selectedKey, setSelectedKey] = useState<{ id: string; team?: string } | null>(null);
  // Three views, aligned with the workbench plugin's WorkflowBoard:
  // 列表 (list + detail) / 卡片 (card grid) / 拓扑 (DAG).
  const [view, setView] = useState<'list' | 'card' | 'topo'>('list');

  const projects = data?.projects ?? [];
  const selected =
    projects.find((p) => isSameProject(p, selectedKey)) ?? null;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="项目"
        description="AgentTeams 项目 API — 标准项目视图"
        isLive
        onRefresh={() => refetch()}
        isRefreshing={isRefetching}
        actions={
          <div className="flex items-center gap-1">
            {(
              [
                { key: 'list', label: '列表', icon: List },
                { key: 'card', label: '卡片', icon: LayoutGrid },
                { key: 'topo', label: '拓扑', icon: GitBranch },
              ] as const
            ).map((v) => (
              <Button
                key={v.key}
                variant={view === v.key ? 'default' : 'outline'}
                size="sm"
                onClick={() => setView(v.key)}
              >
                <v.icon className="h-3.5 w-3.5 mr-1" />
                {v.label}
              </Button>
            ))}
          </div>
        }
      />

      <DegradedBanner
        degraded={data?.degraded}
        degradedReason={data?.degradedReason}
        error={data?.error}
      />

      {isLoading && (
        <div className="flex items-center justify-center py-10 text-muted-foreground text-sm gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> 加载项目…
        </div>
      )}

      {isError && !data && (
        <div className="text-center py-10 text-muted-foreground text-sm">
          无法连接项目 API（网络错误或代理不可用）
        </div>
      )}

      {!isLoading && !isError && projects.length === 0 && !data?.degraded && (
        <div className="text-center py-10 text-muted-foreground text-sm">
          暂无项目——通过 TeamHarness projectflow 创建的项目会显示在这里
        </div>
      )}

      {projects.length > 0 && view === 'list' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Project list */}
          <Card className="glass-card lg:col-span-1">
            <CardContent className="p-3 space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                <FolderKanban className="h-3.5 w-3.5" />
                项目列表（{projects.length}）
              </p>
              {projects.map((p) => (
                <button
                  key={`${p.team_id ?? ''}:${p.project_id}`}
                  onClick={() => setSelectedKey({ id: p.project_id, team: p.team_id })}
                  className={`w-full text-left rounded-lg border p-2.5 text-xs transition-colors ${
                    isSameProject(selected, p)
                      ? 'border-primary/50 bg-primary/5'
                      : 'border-transparent hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{p.title}</span>
                    <ProjectStatusBadge status={p.status} />
                  </div>
                  <p className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">
                    {p.project_id}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {p.team_id ? `团队 ${p.team_id} · ` : ''}
                    {p.plan_type ?? 'dag'} · {p.mode ?? 'project'}
                  </p>
                </button>
              ))}
            </CardContent>
          </Card>

          {/* Workflow detail */}
          <Card className="glass-card lg:col-span-2">
            <CardContent className="p-4">
              {selected ? (
                <WorkflowDetail projectId={selected.project_id} teamId={selected.team_id} />
              ) : (
                <p className="text-center py-10 text-muted-foreground text-sm">
                  选择左侧项目查看工作流
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {projects.length > 0 && view === 'card' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {projects.map((p) => (
              <ProjectCard
                key={`${p.team_id ?? ''}:${p.project_id}`}
                project={p}
                selected={isSameProject(selected, p)}
                onSelect={() => setSelectedKey({ id: p.project_id, team: p.team_id })}
              />
            ))}
          </div>
          {selected && (
            <Card className="glass-card">
              <CardContent className="p-4">
                <WorkflowDetail projectId={selected.project_id} teamId={selected.team_id} />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {projects.length > 0 && view === 'topo' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="glass-card lg:col-span-1">
            <CardContent className="p-3 space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                <GitBranch className="h-3.5 w-3.5" />
                选择项目（{projects.length}）
              </p>
              {projects.map((p) => (
                <button
                  key={`${p.team_id ?? ''}:${p.project_id}`}
                  onClick={() => setSelectedKey({ id: p.project_id, team: p.team_id })}
                  className={`w-full text-left rounded-lg border p-2.5 text-xs transition-colors ${
                    isSameProject(selected, p)
                      ? 'border-primary/50 bg-primary/5'
                      : 'border-transparent hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{p.title}</span>
                    <ProjectStatusBadge status={p.status} />
                  </div>
                  <p className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">
                    {p.project_id}
                  </p>
                </button>
              ))}
            </CardContent>
          </Card>
          <Card className="glass-card lg:col-span-2">
            <CardContent className="p-4">
              {selected ? (
                <WorkflowDagView projectId={selected.project_id} teamId={selected.team_id} />
              ) : (
                <p className="text-center py-10 text-muted-foreground text-sm">
                  选择左侧项目查看依赖图
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
