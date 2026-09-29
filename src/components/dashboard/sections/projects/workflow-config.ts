import { toast } from 'sonner';
import { ApiError } from '@/lib/api-error';
import type { ProjectStatus, WorkflowNodeStatus } from '@/lib/agentteams-projects-api';
import type { DagNodeColor } from '@/components/dashboard/project-dag-svg';

// ----- Status config -----
// Colors live in src/lib/status-colors.ts (shared with tasks-section,
// dual-mode for light/dark themes — UI-01).

// Same Chinese labels as tasks-section's PROJECT_STATUS_LABEL.
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planning: '规划中',
  active: '进行中',
  paused: '已暂停',
  completed: '已完成',
  unknown: '未知',
};

export const NODE_STATUS_COLOR: Record<WorkflowNodeStatus, string> = {
  pending: 'text-slate-500 bg-slate-500/10 border-slate-500/30',
  delegated: 'text-blue-500 bg-blue-500/10 border-blue-500/30',
  'in-progress': 'text-violet-500 bg-violet-500/10 border-violet-500/30',
  completed: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30',
  revision: 'text-amber-500 bg-amber-500/10 border-amber-500/30',
  blocked: 'text-red-500 bg-red-500/10 border-red-500/30',
};

// Mirrors tasks-section column labels (待办/已派发/执行中/已完成/阻塞).
export const NODE_STATUS_LABEL: Record<WorkflowNodeStatus, string> = {
  pending: '待办',
  delegated: '已派发',
  'in-progress': '执行中',
  completed: '已完成',
  revision: '需修订',
  blocked: '阻塞',
};

/** Normalize a raw TaskMeta status to the frontend enum, mirroring the
 * controller's normalizeTaskStatus (project_handler.go): planned→pending,
 * assigned→delegated, in_progress/submitted→in-progress, cancelled→blocked.
 * tasks_detail and loop tasks carry the RAW status, while workflow nodes are
 * already normalized. */
export function normalizeNodeStatus(raw?: string): WorkflowNodeStatus {
  switch (raw) {
    case 'planned':
    case '':
      return 'pending';
    case 'assigned':
      return 'delegated';
    case 'in_progress':
    case 'submitted':
      return 'in-progress';
    case 'completed':
      return 'completed';
    case 'revision':
      return 'revision';
    case 'blocked':
    case 'cancelled':
      return 'blocked';
    default:
      // Unknown/future controller statuses render as blocked rather than
      // "待办" — a task we don't understand should not look actionable.
      return 'blocked';
  }
}

/** SVG node colors for the workflow DAG view — same palette family as
 * NODE_STATUS_COLOR (badges) mapped to the shared ProjectDagSvg renderer. */
export const WORKFLOW_NODE_FILL: Record<string, DagNodeColor> = {
  pending: { fill: 'rgba(148,163,184,0.12)', stroke: '#94a3b8', text: '#94a3b8' },
  assigned: { fill: 'rgba(59,130,246,0.14)', stroke: '#3b82f6', text: '#93c5fd' },
  in_progress: { fill: 'rgba(139,92,246,0.16)', stroke: '#8b5cf6', text: '#a78bfa' },
  completed: { fill: 'rgba(16,185,129,0.14)', stroke: '#10b981', text: '#34d399' },
  failed: { fill: 'rgba(239,68,68,0.14)', stroke: '#ef4444', text: '#f87171' },
  blocked: { fill: 'rgba(245,158,11,0.14)', stroke: '#f59e0b', text: '#fbbf24' },
  unknown: { fill: 'rgba(148,163,184,0.08)', stroke: '#64748b', text: '#94a3b8' },
};

/** Controller terminal statuses (isTerminalTaskStatus): these tasks cannot
 * be cancelled (409). cancelled itself stays cancellable but is already
 * terminal in practice, so hide the button there too. */
export const UNCANCELLABLE_STATUSES = new Set(['completed', 'revision', 'blocked', 'cancelled']);

/** Surface a project mutation failure with the controller's exact reason
 * (ApiError carries the upstream status + error string, e.g. 409 "project
 * is already paused"). */
export function toastMutationError(action: string, error: unknown) {
  if (error instanceof ApiError) {
    toast.error(`项目${action}失败（HTTP ${error.status}）`, { description: error.message });
  } else {
    toast.error(`项目${action}失败`, {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

/** (team, project_id) composite identity comparison. Accepts both
 * the selection shape ({ id, team }) and the API summary shape
 * ({ project_id, team_id }). */
export function isSameProject(
  a: { project_id?: string; id?: string; team_id?: string; team?: string } | null,
  b: { project_id?: string; id?: string; team_id?: string; team?: string } | null,
): boolean {
  if (!a || !b) return false;
  return (
    (a.project_id ?? a.id ?? '') === (b.project_id ?? b.id ?? '') &&
    (a.team_id ?? a.team ?? '') === (b.team_id ?? b.team ?? '')
  );
}
