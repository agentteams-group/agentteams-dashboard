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

/** Extract a human-readable detail from an error response body.
 * The controller's standard error shape is `{ "message": "..." }`
 * (httputil.ErrorResponse); the dashboard middleware returns
 * `{ "error": "..." }`. Accept both so callers surface the real reason. */
async function extractErrorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const payload = (await res.json()) as { error?: unknown; message?: unknown };
    const fromError =
      payload && typeof payload.error === 'string' && payload.error ? payload.error : '';
    const fromMessage =
      payload && typeof payload.message === 'string' && payload.message ? payload.message : '';
    if (fromMessage) return fromMessage;
    if (fromError) return fromError;
  } catch {
    // non-JSON error body; keep the fallback
  }
  return fallback;
}

async function requestJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch {
    throw new NetworkError(url);
  }
  if (!res.ok) {
    const detail = await extractErrorDetail(res, `HTTP ${res.status}`);
    throw new ApiError(`${detail} from ${url}`, res.status, url);
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
  options: { includeTasks?: boolean; teamId?: string } = {},
): Promise<WorkflowResponse> {
  // #1169 (team, project_id) identity: the same id may exist under two
  // teams. Pass ?team= to disambiguate; without it the controller returns
  // 409 Conflict. includeTasks and teamId are independent query params.
  const qsParts: string[] = [];
  if (options.includeTasks) qsParts.push('includeTasks=true');
  if (options.teamId) qsParts.push(`team=${encodeURIComponent(options.teamId)}`);
  const qs = qsParts.length ? `?${qsParts.join('&')}` : '';
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

// ----- W-PR-2 human intervention write operations (#1172) -----
//
// Each POST returns the controller's refreshed workflow JSON (200). The
// controller's 409 conflict reasons (already paused / not paused / replan
// preconditions) are surfaced as ApiError with the upstream status so the
// UI can show the exact reason.

async function requestPost<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      cache: 'no-store',
    });
  } catch {
    throw new NetworkError(url);
  }
  if (!res.ok) {
    const detail = await extractErrorDetail(res, `HTTP ${res.status}`);
    throw new ApiError(`${detail} from ${url}`, res.status, url);
  }
  return (await res.json()) as T;
}

/** Post a project mutation through the dashboard proxy.
 * `teamId` disambiguates (team, project_id) identity (#1169). */
function mutationUrl(projectId: string, action: string, teamId?: string): string {
  const base = `${PROJECTS_URL}/${encodeURIComponent(projectId)}/${action}`;
  return teamId ? `${base}?team=${encodeURIComponent(teamId)}` : base;
}

/** Pause an active project (POST .../pause, body { reason }). */
export function pauseProject(
  projectId: string,
  options: { reason?: string; teamId?: string } = {},
): Promise<WorkflowResponse> {
  return requestPost<WorkflowResponse>(
    mutationUrl(projectId, 'pause', options.teamId),
    { reason: options.reason ?? '' },
  );
}

/** Resume a paused project (POST .../resume, empty body). */
export function resumeProject(
  projectId: string,
  options: { teamId?: string } = {},
): Promise<WorkflowResponse> {
  return requestPost<WorkflowResponse>(
    mutationUrl(projectId, 'resume', options.teamId),
    {},
  );
}

/** Replace a DAG project's plan (POST .../replan, body { tasks }).
 * The controller validates the new graph (duplicates / unknown deps /
 * cycles) and normalizes fields; 409 on preconditions (non-dag plan type,
 * not active, tasks executing). */
export function replanProject(
  projectId: string,
  tasks: unknown[],
  options: { teamId?: string } = {},
): Promise<WorkflowResponse> {
  return requestPost<WorkflowResponse>(
    mutationUrl(projectId, 'replan', options.teamId),
    { tasks },
  );
}

/** Cancel a single task in a project (POST .../tasks/{taskId}/cancel).
 * `reason` is required by the controller (400 without it); 409 for terminal
 * tasks, 404 when the task is not part of the project's graph. */
export function cancelProjectTask(
  projectId: string,
  taskId: string,
  options: { reason: string; replacementTaskId?: string; teamId?: string },
): Promise<WorkflowResponse> {
  const base = `${PROJECTS_URL}/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/cancel`;
  const url = options.teamId
    ? `${base}?team=${encodeURIComponent(options.teamId)}`
    : base;
  return requestPost<WorkflowResponse>(url, {
    reason: options.reason,
    ...(options.replacementTaskId ? { replacementTaskId: options.replacementTaskId } : {}),
  });
}
