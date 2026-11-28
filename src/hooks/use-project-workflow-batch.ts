'use client';

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-error';
import {
  getProjectWorkflow,
  listProjects,
  type ProjectSummary,
  type WorkflowNodeStatus,
  type WorkflowResponse,
} from '@/lib/agentteams-projects-api';
import {
  useTaskIndex,
  type IndexedTask,
} from '@/hooks/use-projects';
import { useRoomMetaStore } from '@/hooks/use-matrix';
import { useShellPollingInterval } from '@/lib/shell-polling';

const PROJECT_LIST_INTERVAL_MS = 30_000;
const FAST_WORKFLOW_INTERVAL_MS = 5_000;
const WORKFLOW_CONCURRENCY = 4;

export async function runBounded<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (_item: T, _index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

export function projectWorkflowQueryKey(project: Pick<ProjectSummary, 'project_id' | 'team_id'>) {
  return ['agentteams-project-workflow', project.team_id ?? 'any', project.project_id] as const;
}

function normalizedRoomId(value?: string): string | undefined {
  return value?.replace(/^room:/, '') || undefined;
}

/** Only the open project room gets a five-second detail lane. An operations
 * assistant with exactly one matching project keeps that compatibility lane;
 * a busy assistant with many projects relies on the aggregate task index. */
export function selectFastLaneProjects(
  projects: ProjectSummary[],
  tasks: IndexedTask[],
  activeRoomId: string | null,
): ProjectSummary[] {
  if (!activeRoomId) return [];
  const direct = new Set(
    tasks.map(task => normalizedRoomId(task.room_id)).filter(id => id === activeRoomId),
  );
  const sourced = new Set(
    tasks.map(task => normalizedRoomId(task.source_room_id)).filter(id => id === activeRoomId),
  );
  const matches = (task: IndexedTask) => {
    const roomId = normalizedRoomId(task.room_id);
    const sourceRoomId = normalizedRoomId(task.source_room_id);
    return (roomId && direct.has(roomId)) || (sourceRoomId && sourced.has(sourceRoomId));
  };
  const projectIds = new Set(tasks.filter(matches).map(task => task.project_id).filter(Boolean));
  if (direct.size === 0 && sourced.size > 0 && projectIds.size > 1) return [];
  return projects.filter(project => projectIds.has(project.project_id));
}

function normalizeNodeStatus(status: string): WorkflowNodeStatus {
  switch (status) {
    case 'assigned':
    case 'delegated':
      return 'delegated';
    case 'in-progress':
    case 'in_progress':
    case 'running':
    case 'submitted':
      return 'in-progress';
    case 'completed':
      return 'completed';
    case 'revision':
      return 'revision';
    case 'failed':
    case 'error':
    case 'blocked':
    case 'cancelled':
    case 'canceled':
      return 'blocked';
    default:
      return 'pending';
  }
}

/** Compatibility projection for controllers without a batch workflow API.
 * The aggregate task index is the board source; this preserves the workflow
 * shape needed by chat room discovery and task notes without N detail polls. */
export function workflowFromTaskIndex(
  project: ProjectSummary,
  tasks: IndexedTask[],
): WorkflowResponse | null {
  const scoped = tasks.filter(task =>
    task.project_id === project.project_id
    && (task.team_id ?? 'any') === (project.team_id ?? 'any'));
  if (scoped.length === 0) return null;
  const ids = new Set(scoped.map(task => task.task_id));
  const sourceRoomId = scoped.find(task => task.source_room_id)?.source_room_id;
  return {
    project_id: project.project_id,
    title: project.title,
    status: project.status,
    plan_type: project.plan_type,
    team_id: project.team_id,
    mode: project.mode,
    source_room_id: sourceRoomId,
    nodes: scoped.map(task => ({
      id: task.task_id,
      parent_task_id: task.parent_task_id,
      name: task.title || task.task_id,
      status: normalizeNodeStatus(task.status),
      assignee: task.assigned_to,
    })),
    edges: scoped.flatMap(task => (task.depends_on ?? [])
      .filter(dependency => ids.has(dependency))
      .map(dependency => ({ source: dependency, target: task.task_id }))),
    next: scoped.filter(task => !scoped.some(candidate => candidate.depends_on?.includes(task.task_id)))
      .map(task => task.task_id),
    interrupts: [],
    tasks_detail: scoped.map(task => ({
      task_id: task.task_id,
      parent_task_id: task.parent_task_id,
      project_id: task.project_id,
      room_id: task.room_id,
      source_room_id: task.source_room_id,
      status: task.status,
      assigned_to: task.assigned_to,
    })),
  };
}

export interface ProjectWorkflowBatchOptions {
  enabled?: boolean;
  activeRoomId?: string | null;
  room?: { id?: string; agentRole?: string } | null;
}

/** Aggregate-first workflow/board adapter. It deliberately does not call
 * useProjects, so B9 can keep ownership of that hook while chat avoids the
 * one-workflow-query-per-project polling storm. */
export function useProjectWorkflowBatch({
  enabled = true,
  activeRoomId: activeRoomIdOverride,
  room = null,
}: ProjectWorkflowBatchOptions = {}) {
  const queryClient = useQueryClient();
  const storeActiveRoomId = useRoomMetaStore(state => state.activeRoomId);
  const activeRoomId = activeRoomIdOverride === undefined ? storeActiveRoomId : activeRoomIdOverride;
  const list = useQuery({
    queryKey: ['agentteams-projects'],
    queryFn: () => listProjects(),
    enabled,
    staleTime: 5_000,
    refetchInterval: useShellPollingInterval(['agentteams-projects'], PROJECT_LIST_INTERVAL_MS),
    retry: 1,
    placeholderData: previousData => previousData,
    throwOnError: false,
  });
  const taskIndex = useTaskIndex({
    enabled,
    refetchInterval: useShellPollingInterval(['agentteams-task-index'], FAST_WORKFLOW_INTERVAL_MS),
  });
  const projects = useMemo(() => list.data?.projects ?? [], [list.data?.projects]);
  const indexedTasks = useMemo(() => taskIndex.data?.tasks ?? [], [taskIndex.data?.tasks]);
  const roomId = room?.id ?? activeRoomId;
  const fastLane = useMemo(
    () => selectFastLaneProjects(projects, indexedTasks, roomId),
    [projects, indexedTasks, roomId],
  );
  const fastKey = fastLane.map(project => `${project.team_id ?? 'any'}/${project.project_id}`).sort();
  const batchKey = ['agentteams-project-workflow-batch', fastKey] as const;
  const batch = useQuery({
    queryKey: batchKey,
    queryFn: async () => {
      const settled = await runBounded(fastLane, WORKFLOW_CONCURRENCY, project =>
        getProjectWorkflow(project.project_id, { includeTasks: true, teamId: project.team_id })
          .then(workflow => {
            queryClient.setQueryData(projectWorkflowQueryKey(project), workflow);
            return { status: 'fulfilled' as const, value: [project.project_id, workflow] as const };
          })
          .catch(reason => ({ status: 'rejected' as const, reason })));
      const successes = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
      if (settled.some(result => result.status === 'rejected')) {
        throw new AggregateError(settled.filter(result => result.status === 'rejected').map(result => result.reason));
      }
      return Object.fromEntries(successes);
    },
    enabled: enabled && !list.data?.degraded && !list.isError && fastLane.length > 0,
    staleTime: FAST_WORKFLOW_INTERVAL_MS,
    refetchInterval: useShellPollingInterval(batchKey, FAST_WORKFLOW_INTERVAL_MS),
    retry: 1,
    throwOnError: false,
  });

  const taskIndexUnavailable = taskIndex.isError
    && !(taskIndex.error instanceof ApiError && taskIndex.error.status === 404);
  const degraded = Boolean(list.data?.degraded) || list.isError || taskIndexUnavailable;

  const workflows = useMemo(() => {
    const result: WorkflowResponse[] = [];
    const batchWorkflows = batch.data ?? {};
    for (const project of projects) {
      // Detail completion is a data change even when the aggregate task-index
      // object retains its identity. Prefer the batch result explicitly.
      const cached = batchWorkflows[project.project_id]
        ?? queryClient.getQueryData<WorkflowResponse>(projectWorkflowQueryKey(project));
      const workflow = cached ?? workflowFromTaskIndex(project, indexedTasks);
      if (workflow) result.push({ ...workflow, team_id: workflow.team_id ?? project.team_id });
    }
    return result;
  }, [projects, indexedTasks, queryClient, batch.data]);

  const refresh = useCallback(() => {
    void list.refetch();
    void taskIndex.refetch();
    void queryClient.invalidateQueries({ queryKey: ['agentteams-project-workflow-batch'] });
  }, [list, taskIndex, queryClient]);

  return {
    projects,
    workflows,
    taskIndex: indexedTasks,
    fastLaneProjectIds: fastLane.map(project => project.project_id),
    batchKey,
    loading: list.isLoading || taskIndex.isLoading || batch.isLoading,
    degraded,
    partialError: batch.isError,
    refresh,
  };
}

export type ProjectWorkflowBatch = ReturnType<typeof useProjectWorkflowBatch>;
