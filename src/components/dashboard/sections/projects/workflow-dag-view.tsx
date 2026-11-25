'use client';

import { useMemo } from 'react';
import { GitBranch, Loader2 } from 'lucide-react';
import { SectionEmptyState } from '@/components/dashboard/section-empty-state';
import { useProjectWorkflow } from '@/hooks/use-projects';
import { ProjectDagSvg } from '@/components/dashboard/project-dag-svg';
import { buildWorkflowDag } from '@/lib/project-dag';
import { WORKFLOW_NODE_FILL } from './workflow-config';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { openChatRoom } from '@/lib/open-chat-room';

// ----- Workflow DAG view (topo) -----

export function WorkflowDagView({
  projectId,
  teamId,
}: {
  projectId: string;
  teamId?: string;
}) {
  const { data: wf, isLoading, isError } = useProjectWorkflow(projectId, teamId);
  // 卡住节点定位（F5.1）：责任 Agent 名 → roomID，点击直达其会话。
  const { data: workers } = useWorkers();
  const dag = useMemo(
    () =>
      wf
        ? buildWorkflowDag(
            wf.nodes.map((n) => ({
              id: n.id,
              name: n.name,
              status: n.status,
              ...(n.assignee ? { assignee: n.assignee } : {}),
            })),
            wf.edges.map((e) => ({
              source: e.source,
              target: e.target,
              ...(e.conditional === true ? { conditional: true } : {}),
            })),
            wf.next,
          )
        : { nodes: [], edges: [], externalDeps: [] as string[] },
    [wf],
  );

  const stuckNodeOwnerRoom = (nodeId: string): string | undefined => {
    const node = dag.nodes.find((n) => n.id === nodeId);
    if (!node?.assignee) return undefined;
    return workers?.find((w) => w.name === node.assignee)?.roomID;
  };

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
    return <SectionEmptyState icon={GitBranch} title="该项目暂无任务节点" />;
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
        <span className="text-xs text-muted-foreground/70 font-normal">
          {dag.nodes.length} 任务 · {dag.edges.length} 依赖
          {dag.externalDeps.length > 0 && ` · ${dag.externalDeps.length} 外部依赖`}
        </span>
      </p>
      <div className="rounded-lg border bg-background/40 overflow-x-auto p-2">
        <ProjectDagSvg
          dag={dag}
          nodeColors={WORKFLOW_NODE_FILL}
          title={`${wf.title} 任务依赖图（amber=关键路径 · 虚线=条件分支 · 红点=卡住节点）`}
          onStuckNodeClick={(nodeId) => openChatRoom(stuckNodeOwnerRoom(nodeId))}
        />
        <p className="mt-1.5 text-xs text-muted-foreground/70">
          <span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1 align-middle" aria-hidden="true" />
          关键路径
          <span className="inline-block w-4 border-t border-dashed border-muted-foreground ml-3 mr-1 align-middle" aria-hidden="true" />
          条件分支
          <span className="inline-block w-2 h-2 rounded-full bg-red-500 ml-3 mr-1 align-middle" aria-hidden="true" />
          卡住节点（点击直达责任 Agent 会话）
        </p>
      </div>
    </div>
  );
}
