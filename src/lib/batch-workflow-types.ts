// Batch Workflow Type Definitions
// Core interfaces for the batch operations editor and execution engine.

export type BatchStepType = 'select' | 'validate' | 'action' | 'notify';
export type ActionVerb = 'wake' | 'ensure-ready' | 'sleep' | 'delete';
export type ExecutionStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';
export type StepStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'failed';

export interface SelectConfig {
  filter?: string;
  workerNames?: string[];
  teamFilter?: string;
  phaseFilter?: WorkerPhase[];
}

export interface ValidateConfig {
  requiredPhase?: WorkerPhase;
  minHealthScore?: number;
  mustHaveMatrix?: boolean;
}

export interface ActionConfig {
  verb: ActionVerb;
  confirm: boolean;
}

export interface NotifyConfig {
  channel: 'matrix' | 'slack' | 'email';
  message?: string;
}

export interface BatchStep {
  id: string;
  type: BatchStepType;
  order: number;
  config: SelectConfig | ValidateConfig | ActionConfig | NotifyConfig;
  status?: StepStatus;
  startedAt?: number;
  completedAt?: number;
  errorMessage?: string;
  affectedCount?: number;
}

export interface BatchWorkflow {
  id: string;
  name: string;
  description?: string;
  steps: BatchStep[];
  schedule?: { cron: string };
  createdAt: number;
  updatedAt: number;
  lastExecutedAt?: number;
  lastExecutionStatus?: ExecutionStatus;
  lastAffectedCount?: number;
}

export interface DryRunResult {
  predictedAffectedWorkers: string[];
  predictedSkippedWorkers: string[];
  predictedFailures: Array<{ worker: string; stepId: string; reason: string }>;
  estimatedDurationMs: number;
}

export interface ExecutionLogEntry {
  stepId: string;
  stepOrder: number;
  stepType: BatchStepType;
  status: StepStatus;
  startedAt: number;
  completedAt: number;
  affectedWorkers: string[];
  error?: string;
}

export interface BatchExecutionResult {
  workflowId: string;
  workflowName: string;
  startedAt: number;
  completedAt: number;
  status: ExecutionStatus;
  steps: ExecutionLogEntry[];
  totalAffected: number;
  totalFailed: number;
}

/**
 * Lightweight entry stored in execution history (last 10 runs per workflow).
 */
export interface ExecutionHistoryEntry {
  id: string;
  workflowId: string;
  workflowName: string;
  startedAt: number;
  completedAt: number;
  status: ExecutionStatus;
  totalAffected: number;
  totalFailed: number;
}

// Known worker phases referenced by validate step filters
export type WorkerPhase = 'Pending' | 'Running' | 'Sleeping' | 'Updating' | 'Stopped' | 'Failed' | 'Ready';

/**
 * Default steps provided when creating a new workflow from scratch.
 */
export const DEFAULT_STEPS: Omit<BatchStep, 'id' | 'order'>[] = [
  {
    type: 'select',
    config: { filter: '' },
  },
  {
    type: 'validate',
    config: { requiredPhase: 'Sleeping' },
  },
  {
    type: 'action',
    config: { verb: 'wake', confirm: true },
  },
];

/**
 * Known action verbs with labels.
 */
export const ACTION_VERBS: { value: ActionVerb; label: string }[] = [
  { value: 'wake', label: '唤醒' },
  { value: 'ensure-ready', label: '确保就绪' },
  { value: 'sleep', label: '睡眠' },
  { value: 'delete', label: '删除' },
];

/**
 * Step type labels for display.
 */
export const STEP_TYPE_LABELS: Record<BatchStepType, string> = {
  select: '选择',
  validate: '验证',
  action: '执行动作',
  notify: '通知',
};

/**
 * Step type icons (Lucide) names for reference; actual import handled in UI component.
 */
export const STEP_TYPE_ICONS: Record<BatchStepType, string> = {
  select: 'filter',
  validate: 'check-circle',
  action: 'play',
  notify: 'bell',
};

/**
 * Step status colors for display.
 */
export const STEP_STATUS_STYLE: Record<StepStatus, { bg: string; text: string }> = {
  pending: { bg: 'bg-muted/30', text: 'text-muted-foreground' },
  running: { bg: 'bg-blue-500/20', text: 'text-blue-500' },
  completed: { bg: 'bg-emerald-500/20', text: 'text-emerald-500' },
  skipped: { bg: 'bg-amber-500/20', text: 'text-amber-500' },
  failed: { bg: 'bg-red-500/20', text: 'text-red-500' },
};
