'use client';

import { useState } from 'react';
import { GitBranch, FolderKanban, CircleAlert, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SectionHeader } from '@/components/dashboard/section-header';
import { useProjects, useProjectWorkflow } from '@/hooks/use-projects';
import type { ProjectStatus, WorkflowNodeStatus } from '@/lib/agentteams-projects-api';

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

function WorkflowDetail({ projectId }: { projectId: string }) {
  const { data: wf, isLoading, isError, refetch, isRefetching } = useProjectWorkflow(projectId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground text-sm gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> 加载工作流…
      </div>
    );
  }

  if (isError || !wf) {
    return (
      <div className="text-center py-10 text-muted-foreground text-sm">
        无法加载项目工作流（项目不存在或 API 不可用）
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
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const projects = data?.projects ?? [];
  const selected = projects.find((p) => p.project_id === selectedId) ?? null;

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
                  key={p.project_id}
                  onClick={() => setSelectedId(p.project_id)}
                  className={`w-full text-left rounded-lg border p-2.5 text-xs transition-colors ${
                    selected?.project_id === p.project_id
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
                <WorkflowDetail projectId={selected.project_id} />
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
