export interface WorkflowItem {
  id?: string;
  name?: string;
  title?: string;
  status?: string;
  /** 责任 Agent（接力卡 F1.2：node.assignee / task.assigned_to）。 */
  assignedTo?: string;
  /** 上游依赖的显示名列表（接力卡 F1.2：edges 反推，串行链可视化）。 */
  dependsOn?: string[];
  /** 任务摘要（接力卡 F1.2：tasks_detail.summary，子项展开显示）。 */
  summary?: string;
  [key: string]: unknown;
}

export interface WorkflowPayload {
  title?: string;
  name?: string;
  status?: string;
  runId?: string;
  run_id?: string;
  subagents?: WorkflowItem[];
  steps?: WorkflowItem[];
  [key: string]: unknown;
}

export function isWorkflowPayload(value: unknown): value is WorkflowPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
