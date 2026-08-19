// AgentTeams Projects API client (frontend side).
//
// These types mirror the AgentTeams controller project API:
//
//   GET /api/v1/projects                               -> ProjectListResponse
//   GET /api/v1/projects/{id}/workflow[?includeTasks]  -> WorkflowResponse
//   GET /api/v1/projects/{id}/tasks/{taskId}/artifact  -> binary stream
//   GET /api/v1/projects/{id}/history[?team]           -> ProjectHistoryResponse
//   GET /api/v1/projects/{id}/history/{ts}[?team]      -> raw meta JSON
//
// All requests go through the Next.js proxy routes under
// `/api/agentteams/projects/*` (which add the SA-token bearer and are
// themselves gated by the Higress-session middleware). The workflow
// payload follows the LangGraph-style shape (nodes/edges/next/interrupts/
// values) agreed in the project-workflow design. Field names/types are verified
// against `project_handler.go` (workflowResponse / workflowInterrupt /
// taskDetail / loopMeta structs) and the API doc
// `docs/zh-cn/usage/project-workflow-api.md` — keep in sync when
// the controller schema changes.

import { ApiError, NetworkError } from '@/lib/api-error';
import { extractErrorDetail, requestJson } from './api-base';

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
 * so a dashboard can render a "Resume" button directly. */
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
  /** Human-intervention audit fields. */
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
  /** Why the list degraded: 'api-not-deployed' (404 — the project API is not
   * deployed yet) vs 'controller-error' (500+ — endpoint exists
   * but failed, e.g. MinIO unreachable). */
  degradedReason?: 'api-not-deployed' | 'controller-error';
}

const PROJECTS_URL = '/api/agentteams/projects';

// requestJson / extractErrorDetail now live in ./api-base (shared by all
// agentteams clients — projects, workers, checkpoints — since PR #86 review).

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
  // (team, project_id) identity: the same id may exist under two
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

// ----- human intervention write operations -----
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
 * `teamId` disambiguates (team, project_id) identity. */
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

// ----- project intervention history -----

export interface ProjectHistorySnapshot {
  /** unixNano filename; string — 19-digit nanoseconds exceed JS safe ints. */
  timestamp: string;
}

export interface ProjectHistoryResponse {
  project_id: string;
  snapshots: ProjectHistorySnapshot[];
}

/**
 * Raw meta.json snapshot returned by GET /projects/{id}/history/{timestamp}.
 * Only the fields the timeline panel renders are typed; the stored meta is
 * otherwise open (the controller persists whatever the workflow had), so
 * consumers must keep defensive reads (null/empty checks).
 */
export interface ProjectHistorySnapshotDetail {
  status?: string;
  title?: string;
  updated_by?: string;
  updated_at?: string;
  pause_reason?: string;
  tasks?: unknown[];
}

/** List a project's intervention timeline (newest first). */
export async function getProjectHistory(
  projectId: string,
  teamId?: string,
  signal?: AbortSignal,
): Promise<ProjectHistoryResponse> {
  const qs = teamId ? `?team=${encodeURIComponent(teamId)}` : '';
  return requestJson<ProjectHistoryResponse>(
    `${PROJECTS_URL}/${encodeURIComponent(projectId)}/history${qs}`,
    signal,
  );
}

/** Fetch one pre-intervention snapshot's raw meta JSON. */
export async function getProjectHistorySnapshot(
  projectId: string,
  timestamp: string,
  teamId?: string,
  signal?: AbortSignal,
): Promise<ProjectHistorySnapshotDetail> {
  const qs = teamId ? `?team=${encodeURIComponent(teamId)}` : '';
  return requestJson<ProjectHistorySnapshotDetail>(
    `${PROJECTS_URL}/${encodeURIComponent(projectId)}/history/${encodeURIComponent(timestamp)}${qs}`,
    signal,
  );
}
