'use client';

import { useState } from 'react';
import { GitBranch, FolderKanban, CircleAlert, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SectionHeader } from '@/components/dashboard/section-header';
import { useProjects, useProjectWorkflow } from '@/hooks/use-projects';
import { ApiError } from '@/lib/api-error';
import {
  getTaskArtifactUrl,
  type ProjectStatus,
  type WorkflowNodeStatus,
  type WorkflowTaskDetail,
} from '@/lib/agentteams-projects-api';

// ----- Status config (mirrors tasks-section colors) -----

const PROJECT_STATUS_COLOR: Record<ProjectStatus, string> = {
  planning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  active: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  paused: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30',
  completed: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30',
  unknown: 'bg-muted text-muted-foreground border',
};

const NODE_STATUS_COLOR: Record<WorkflowNodeStatus, string> = {
  pending: 'bg-muted text-muted-foreground border',
  delegated: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  'in-progress': 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30',
  completed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  revision: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30',
  blocked: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30',
};

/** One task's TaskMeta row: status/assignee/result + artifact download
 *  links (result_path + each deliverable, via O19 proxy). */
function TaskDetailRow({
  task,
  projectId,
}: {
  task: WorkflowTaskDetail;
  projectId: string;
}) {
  const deliverables = Array.isArray(task.deliverables)
    ? task.deliverables.filter((d): d is string => typeof d === 'string')
    : [];
  return (
    <div className="rounded-lg border bg-background/40 p-2 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[10px] text-muted-foreground">{task.task_id}</span>
        {task.status && (
          <Badge className={`text-[10px] border ${NODE_STATUS_COLOR[task.status as WorkflowNodeStatus] ?? ''}`}>
            {task.status}
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
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400 hover:bg-amber-500/15 transition-colors"
      title={href}
    >
      <FolderKanban className="h-3 w-3" />
      {label}
    </a>
  );
}

function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge className={`text-[10px] gap-1 border ${PROJECT_STATUS_COLOR[status] ?? PROJECT_STATUS_COLOR.unknown}`}>
      {status}
    </Badge>
  );
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
      : 'Controller 项目 API 未部署（等待 AgentTeams #1169 合并）';
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground text-sm gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> 加载工作流…
      </div>
    );
  }

  if (isError || !wf) {
    // 409 = 同一 project_id 在多个团队存在（#1169 (team, project_id) 身份），
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
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isRefetching}>
          <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
        </Button>
      </div>

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
                  {t.status && <Badge className={`text-[10px] border ${NODE_STATUS_COLOR[t.status as WorkflowNodeStatus] ?? ''}`}>{t.status}</Badge>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Next runnable tasks (W-PR-1 next: 依赖全完成、当前可执行) */}
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
                {status}: {count}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Task details (#1169 includeTasks → tasks_detail + O19 artifact download) */}
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
              />
            ))}
          </div>
        </div>
      )}

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
                  {n.status}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ----- Main section -----

export function ProjectsSection() {
  const { data, isLoading, isError, refetch, isRefetching } = useProjects();
  // (team, project_id) composite selection — the same project id can exist
  // under two teams (#1169 identity scoping).
  const [selectedKey, setSelectedKey] = useState<{ id: string; team?: string } | null>(null);

  const projects = data?.projects ?? [];
  const selected =
    projects.find(
      (p) =>
        p.project_id === selectedKey?.id &&
        (p.team_id ?? '') === (selectedKey?.team ?? ''),
    ) ?? null;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="项目"
        description="AgentTeams 项目 API（#1169）— 标准项目视图"
        isLive
        onRefresh={() => refetch()}
        isRefreshing={isRefetching}
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

      {projects.length > 0 && (
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
                    selected?.project_id === p.project_id &&
                    (selected?.team_id ?? '') === (p.team_id ?? '')
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
    </div>
  );
}
