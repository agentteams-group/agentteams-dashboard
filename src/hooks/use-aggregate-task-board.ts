'use client';

import { useCallback, useMemo } from 'react';
import {
  groupLegacyProjectTasks,
  mergeMainTaskIndex,
  workflowToBoard,
} from '@/hooks/use-projects';
import { useProjectWorkflowBatch, type ProjectWorkflowBatchOptions } from './use-project-workflow-batch';

/** Chat-facing board with the same return contract used by the existing board
 * consumers, backed by the aggregate task index and a bounded detail lane. */
export function useAggregatedTaskBoard(options: ProjectWorkflowBatchOptions = {}) {
  const feed = useProjectWorkflowBatch(options);
  const workflowMap = useMemo(
    () => new Map(feed.workflows.map(workflow => [workflow.project_id, workflow])),
    [feed.workflows],
  );
  const board = useMemo(() => {
    const mapped = workflowToBoard(feed.projects, workflowMap);
    return {
      ...mapped,
      tasks: groupLegacyProjectTasks(
        mergeMainTaskIndex(mapped.tasks, feed.taskIndex),
        mapped.projects,
      ),
    };
  }, [feed.projects, feed.taskIndex, workflowMap]);
  const refetch = useCallback(() => {
    feed.refresh();
  }, [feed]);

  return useMemo(() => ({
    ...board,
    degraded: feed.degraded,
    projectTotal: feed.projects.length,
    hasMoreProjects: false,
    loadMoreProjects: () => {},
    isLoading: feed.loading,
    isRefetching: false,
    isWorkflowsLoading: feed.loading,
    refetch,
    workflows: feed.workflows,
    fastLaneProjectIds: feed.fastLaneProjectIds,
  }), [board, feed.degraded, feed.projects.length, feed.loading, feed.workflows, feed.fastLaneProjectIds, refetch]);
}
