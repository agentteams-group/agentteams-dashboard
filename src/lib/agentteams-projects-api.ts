// AgentTeams Projects API client (frontend side).
//
// These types mirror the AgentTeams controller API introduced by
// agentteams/AgentTeams#1169 (W-PR-1) and extended by #1172 (W-PR-2):
//
//   GET /api/v1/projects                               -> ProjectListResponse
//   GET /api/v1/projects/{id}/workflow[?includeTasks]  -> WorkflowResponse
//   GET /api/v1/projects/{id}/tasks/{taskId}/artifact  -> binary stream
//
// All requests go through the Next.js proxy routes under
// `/api/agentteams/projects/*` (which add the SA-token bearer and are
// themselves gated by the Higress-session middleware). The workflow
// payload follows the LangGraph-style shape (nodes/edges/next/interrupts/
// values) agreed in the W-PR-1 design. Field names/types are verified
// against `project_handler.go` (workflowResponse / workflowInterrupt /
// taskDetail / loopMeta structs) and the API doc
// `docs/zh-cn/usage/project-workflow-api.md` (W-PR-1) — keep in sync when
// the controller schema changes.

import { ApiError, NetworkError } from '@/lib/api-error';

export type ProjectStatus = 'planning' | 'active' | 'paused' | 'completed' | 'unknown';

export type WorkflowNodeStatus =
  | 'pending'
  | 'delegated'
  | 'in-progress'
  | 'completed'
  | 'revision'
  | 'blocked';

export interface ProjectSummary {
  project_id: string;
  title: string;
  status: ProjectStatus;
  plan_type?: 'dag' | 'loop';
  team_id?: string;
  mode?: 'project' | 'quick';
}

export interface WorkflowNode {
  id: string;
  name: string;
  status: WorkflowNodeStatus;
  assignee?: string;
}

export interface WorkflowEdge {
  source: string;
  target: string;
  conditional?: boolean;
}

/** Mirrors workflowInterrupt + interruptActionRequest + interruptConfig.
 * A paused project surfaces as an interrupt with action_request
 * { action: 'resume', args: { project_id } } and config.allow_accept=true,
 * so a dashboard can render a "Resume" button directly (W-PR-2 endpoints). */
export interface WorkflowInterrupt {
  id: string;
  value: string;
  action_request?: InterruptActionRequest;
  config?: InterruptConfig;
  description?: string;
}

export interface InterruptActionRequest {
  action: string;
  args?: Record<string, unknown>;
}

export interface InterruptConfig {
  allow_ignore: boolean;
  allow_respond: boolean;
  allow_edit: boolean;
  allow_accept: boolean;
}

export interface WorkflowValues {
  project_id: string;
  title: string;
  status: ProjectStatus;
  plan_type?: 'dag' | 'loop';
  team_id?: string;
  mode?: 'project' | 'quick';
  /** Task counts per normalized status, e.g. { "pending": 2, "delegated": 1 }. */
  task_count?: Record<string, number>;
}

/** Mirrors loopMeta (project_handler.go). */
export interface WorkflowLoop {
  goal?: string;
  stop_condition?: string;
  iteration_template?: string;
  current_iteration?: number;
  max_iterations?: number;
  status?: string;
  tasks?: WorkflowLoopTask[];
  history?: unknown[];
}

/** Mirrors projectTaskMeta (the loop's executable graph). */
export interface WorkflowLoopTask {
  task_id: string;
  title: string;
  assigned_to?: string;
  depends_on?: string[];
  status?: string;
}

/** Mirrors taskDetail, returned when ?includeTasks=true. */
export interface WorkflowTaskDetail {
  task_id: string;
  project_id?: string;
  status?: string;
  spec_path?: string;
  assigned_to?: string;
  summary?: string;
  result_status?: string;
  deliverables?: unknown[];
  result_path?: string;
  cancel_reason?: string;
}

export interface WorkflowResponse {
  project_id: string;
  title: string;
  status: ProjectStatus;
  plan_type?: 'dag' | 'loop';
  team_id?: string;
  mode?: 'project' | 'quick';
  source?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  next: string[];
  interrupts: WorkflowInterrupt[];
  values?: WorkflowValues;
  loop?: WorkflowLoop;
  requester?: string;
  requester_report?: Record<string, unknown>;
  reply_route?: Record<string, unknown>;
  source_room_id?: string;
  /** Populated only when ?includeTasks=true. */
  tasks_detail?: WorkflowTaskDetail[];
  /** W-PR-2 human-intervention audit fields. */
  updated_by?: string;
  updated_at?: string;
  pause_reason?: string;
}

export interface ProjectListResponse {
  projects: ProjectSummary[];
  total: number;
  /** Set when the controller API is not yet available (degraded empty list). */
  error?: string;
  degraded?: boolean;
  /** Why the list degraded: 'api-not-deployed' (404 — W-PR-1 not merged /
   * controller not upgraded) vs 'controller-error' (500+ — endpoint exists
   * but failed, e.g. MinIO unreachable). */
  degradedReason?: 'api-not-deployed' | 'controller-error';
}

const PROJECTS_URL = '/api/agentteams/projects';

async function requestJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch {
    throw new NetworkError(url);
  }
  if (!res.ok) {
    throw new ApiError(`HTTP ${res.status} from ${url}`, res.status, url);
  }
  return (await res.json()) as T;
}

/** List projects via the dashboard proxy route.
 *
 * Returns the full ProjectListResponse so callers can distinguish a real
 * empty list from a degraded controller (`degraded: true` + `error`).
 */
export async function listProjects(): Promise<ProjectListResponse> {
  return requestJson<ProjectListResponse>(PROJECTS_URL);
}

/** Fetch a single project workflow graph via the dashboard proxy route.
 * Pass `{ includeTasks: true }` to attach per-task TaskMeta as tasks_detail. */
export async function getProjectWorkflow(
  projectId: string,
  options: { includeTasks?: boolean } = {},
): Promise<WorkflowResponse> {
  const qs = options.includeTasks ? '?includeTasks=true' : '';
  return requestJson<WorkflowResponse>(
    `${PROJECTS_URL}/${encodeURIComponent(projectId)}/workflow${qs}`,
  );
}

/** Build the dashboard proxy URL for downloading one task's result artifact.
 *
 * The artifact is a binary stream (controller GET .../artifact, optional
 * ?path= for a specific deliverable); it is not fetched through requestJson —
 * the frontend uses this URL directly, e.g. `<a href={...}>` or window.open.
 * The controller performs the path whitelist + existence checks.
 */
export function getTaskArtifactUrl(
  projectId: string,
  taskId: string,
  path?: string,
): string {
  const base = `${PROJECTS_URL}/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/artifact`;
  return path ? `${base}?path=${encodeURIComponent(path)}` : base;
}
