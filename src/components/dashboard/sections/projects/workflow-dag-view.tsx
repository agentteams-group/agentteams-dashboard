'use client';

import { useMemo } from 'react';
import { GitBranch, Loader2 } from 'lucide-react';
import { useProjectWorkflow } from '@/hooks/use-projects';
import { ProjectDagSvg } from '@/components/dashboard/project-dag-svg';
import { buildWorkflowDag } from '@/lib/project-dag';
import { WORKFLOW_NODE_FILL } from './workflow-config';

// ----- Workflow DAG view (topo) -----

export function WorkflowDagView({
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
