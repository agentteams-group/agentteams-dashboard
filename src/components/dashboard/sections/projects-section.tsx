'use client';

import { useMemo, useState } from 'react';
import { GitBranch, FolderKanban, Loader2, List, LayoutGrid } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SectionHeader } from '@/components/dashboard/section-header';
import { useProjects } from '@/hooks/use-projects';
import { projectTs } from '@/lib/project-time';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { isSameProject } from './projects/workflow-config';
import { ProjectStatusBadge, DegradedBanner } from './projects/status-views';
import { ProjectCard } from './projects/project-card';
import { WorkflowDagView } from './projects/workflow-dag-view';
import { WorkflowDetail } from './projects/workflow-detail';

// WorkflowDetail lives in projects/workflow-detail.tsx; re-exported here so
// tasks-section's `import { WorkflowDetail } from './projects-section'` keeps
// working across the A5 split.
export { WorkflowDetail } from './projects/workflow-detail';

// 拓扑视图左栏排序模式（9/16 装验反馈：左栏项目按时间排序）。
type TopoSortMode = 'time_desc' | 'time_asc' | 'name';

// ----- Main section -----

export function ProjectsSection() {
  const { data, isLoading, isError, refetch, isRefetching } = useProjects();
  // (team, project_id) composite selection — the same project id can exist
  // under two teams (identity scoping).
  const [selectedKey, setSelectedKey] = useState<{ id: string; team?: string } | null>(null);
  // Three views, aligned with the workbench plugin's WorkflowBoard:
  // 列表 (list + detail) / 卡片 (card grid) / 拓扑 (DAG).
  const [view, setView] = useState<'list' | 'card' | 'topo'>('list');
  const projects = useMemo(() => data?.projects ?? [], [data]);
  // 拓扑视图左栏排序（9/16 装验反馈：左栏项目按时间排序）。
  const [topoSort, setTopoSort] = useState<TopoSortMode>('time_desc');
  const topoProjects = useMemo(() => {
    const list = [...projects];
    list.sort((a, b) => {
      if (topoSort === 'name') {
        return (a.title || a.project_id).localeCompare(b.title || b.project_id);
      }
      const ta = projectTs(a);
      const tb = projectTs(b);
      // 无时间戳的条目垫底（与 artifacts-section 同款语义）
      if (ta === 0 && tb === 0) return a.title.localeCompare(b.title);
      if (ta === 0) return 1;
      if (tb === 0) return -1;
      return topoSort === 'time_desc' ? tb - ta : ta - tb;
    });
    return list;
  }, [projects, topoSort]);

  // Atomically consume the pending project deep-link during render.
  const pendingProjectKey = useHitlInboxStore.getState().takePendingProjectKey();
  if (pendingProjectKey && pendingProjectKey.id) {
    setSelectedKey(pendingProjectKey);
  }

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
            <CardContent className="p-4 max-h-[calc(100vh-160px)] overflow-y-auto overscroll-contain">
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
              <CardContent className="p-4 max-h-[calc(100vh-160px)] overflow-y-auto overscroll-contain">
                <WorkflowDetail projectId={selected.project_id} teamId={selected.team_id} />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {projects.length > 0 && view === 'topo' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <Card className="glass-card lg:col-span-1">
            <CardContent className="p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <GitBranch className="h-3.5 w-3.5" />
                  选择项目（{projects.length}）
                </p>
                <Select
                  value={topoSort}
                  onValueChange={(v) => setTopoSort(v as TopoSortMode)}
                >
                  <SelectTrigger className="h-7 w-[108px] text-xs" aria-label="项目排序">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="time_desc">时间 新→旧</SelectItem>
                    <SelectItem value="time_asc">时间 旧→新</SelectItem>
                    <SelectItem value="name">名称</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* 左栏独立滚动（9/16 装验反馈：左右分栏、各自独立滚动） */}
              <div className="max-h-[calc(100vh-280px)] overflow-y-auto pr-0.5 -mr-0.5">
              {topoProjects.map((p) => (
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
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card lg:col-span-2">
            {/* 右栏独立滚动（9/16 装验反馈：左右分栏、各自独立滚动） */}
            <CardContent className="p-4 max-h-[calc(100vh-280px)] overflow-y-auto">
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
