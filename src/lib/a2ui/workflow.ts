export interface WorkflowItem {
  id?: string;
  name?: string;
  title?: string;
  status?: string;
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
