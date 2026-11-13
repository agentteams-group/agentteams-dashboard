// AgentTeams API Client - Complete TypeScript API layer
// All requests go through Next.js API proxy routes

import { ApiError, NetworkError } from '@/lib/api-error';
import { apiUrl, extractErrorDetail } from '@/lib/api-base';
import { conditionalFetch, currentReadScope } from '@/lib/conditional-fetch';
import { normalizeWorkerMcpItems, type WorkerMcpResult } from '@/lib/worker-mcp';
import { MANAGER_LOG_TAIL, clampLogTail } from '@/lib/manager-logs';
import {
  getProjectMeta as fetchProjectMeta,
  getTaskMeta as fetchTaskMeta,
  saveProjectMeta as putProjectMeta,
  saveTaskMeta as putTaskMeta,
  type MetaReadResult,
} from '@/lib/meta-api';
import type { SkillEntry, NacosConfig } from '@/lib/skill-center-types';
import {
  buildWorkspaceAccessPayload,
  extractWorkspaceAccess,
  workspaceAccessEqual,
  type WorkspaceAccess,
} from '@/lib/workspace-access';

export type { WorkerMcpItem, WorkerMcpResult } from '@/lib/worker-mcp';
export type { MetaReadResult } from '@/lib/meta-api';

// ============ Response Types ============

export type WorkerPhase = 'Pending' | 'Running' | 'Sleeping' | 'Updating' | 'Stopped' | 'Failed' | 'Ready';
export type WorkerState = 'Running' | 'Sleeping' | 'Stopped';
export type WorkerRuntime = 'openclaw' | 'copaw' | 'hermes' | 'openhuman' | 'qwenpaw' | 'deepseek-harness' | 'codex';
export type TeamPhase = 'Pending' | 'Active' | 'Degraded' | 'Failed';
export type HumanPhase = 'Pending' | 'Active' | 'Failed';
export type ManagerPhase = 'Running' | 'Pending' | 'Failed';
export type ManagerState = 'Running' | 'Sleeping' | 'Stopped';
// The `model` field is the request model alias forwarded to the AI Gateway.
export type RequestModelAlias = string;

export interface ExposedPort {
  port: number;
  domain: string;
}

// LLM 调优字段（#146 缺口 3）：见 src/lib/llm-tuning.ts。空/缺省 = 未设置
// （回退团队默认，再回退 QwenPaw registry 默认）。Worker / Team 同构。
export interface LlmTuningFields {
  llmMaxRetries?: string;
  llmBackoffBase?: string;
  llmBackoffCap?: string;
  llmMaxConcurrent?: string;
  llmMaxQpm?: string;
  llmRateLimitPause?: string;
  llmRateLimitJitter?: string;
  llmAcquireTimeout?: string;
  llmStreamFirstContentTimeout?: string;
  llmStreamIdleTimeout?: string;
}

export interface WorkerResponse extends LlmTuningFields {
  env?: Record<string, string>;
  envEditable?: boolean;
  name: string;
  phase: WorkerPhase;
  state: WorkerState;
  containerManaged: boolean;
  model: RequestModelAlias;
  /** APIG Model API name（per-worker LLM provider）；列表投影可能缺省。 */
  modelProvider?: string;
  runtime: WorkerRuntime;
  image: string;
  containerState: string;
  matrixUserID: string;
  roomID: string;
  message: string;
  exposedPorts?: ExposedPort[];
  team: string;
  role: string;
  skills?: string[];
  agents?: string;
  mcpServers?: { name: string; url: string; transport: string }[];
  version?: string;
  /** ISO8601 time when the worker entered the current phase (optional, backend vNext). */
  stateStartedAt?: string;
  /** ISO8601 time of the worker's most recent Matrix activity (optional, backend vNext). */
  lastActivityAt?: string;
  /** Short summary of the most recent task (optional, <= 32 chars, backend vNext). */
  lastTaskSummary?: string;
  /** Runtime task-level state from the worker heartbeat: "idle" | "running" | "disabled"; empty/undefined = not reported (older controller). */
  agentStatus?: 'idle' | 'running' | 'disabled' | (string & {});
  /** Number of tasks the worker runtime is currently executing (optional, backend vNext). */
  runningTaskCount?: number;
  /** ISO8601 time the worker's task tracker last started a run (optional, backend vNext). */
  lastRunAt?: string;
  /** ISO8601 time the worker's task tracker last finished a run (optional, backend vNext). */
  lastFinishAt?: string;
}

export interface TeamResponse extends LlmTuningFields {
  name: string;
  teamName: string;
  phase: TeamPhase;
  description: string;
  admin: { name: string } | null;
  humanMembers: string[];
  leaderName: string;
  leaderHeartbeat: { enabled: boolean; every: string } | null;
  workerIdleTimeout: string;
  teamRoomID: string;
  leaderDMRoomID: string;
  leaderReady: boolean;
  readyWorkers: number;
  totalWorkers: number;
  message: string;
  /** 团队成员可互 @（TeamSpec.peerMentions，缺省 = 控制器默认 true；旧控制器不投影）。 */
  peerMentions?: boolean;
  workerNames: string[];
  workerExposedPorts: Record<string, ExposedPort[]>;
  /** 团队心跳间隔（TeamSpec.heartbeatEvery，如 "10m"；旧控制器不投影）。 */
  heartbeatEvery?: string;
  /** 子代理默认模型（TeamSpec.subagentModel；留空 = 继承各 Worker 主模型）。 */
  subagentModel?: string;
}

// ----- team attention inbox (upstream #1503) -----
//
// `GET /api/v1/teams/{name}/attention` aggregates the in-flight human
// questions (approval / decision / escalation) of every project of one team
// into a single read. The row shape follows the workbench contract
// (camelCase) and is the same record the project-scoped #1434 endpoint
// projects; the answer still goes to the task's Matrix room, so this is a
// read-only surface.

/** One selectable answer, description optional and passed through verbatim. */
export interface TeamAttentionOption {
  id: string;
  label: string;
  description: string;
}

/**
 * The notification delivery outcome recorded with the attention request
 * (`notification_log` in the task meta). `gaps` lists the delivery steps that
 * did not complete, so the UI can distinguish "nobody was told" from "told,
 * no reply yet".
 */
export interface TeamAttentionNotified {
  sent: boolean;
  roomAccepted: boolean;
  channelAccepted: unknown;
  recipients: unknown[];
  gaps: unknown[];
  at: string;
}

/** One inbox row. Pointer fields serialize as `null` when absent. */
export interface TeamAttentionItem {
  taskId: string;
  /** Matrix event id of the room message that raised the record (`null` when the notification was withheld). */
  eventId: string | null;
  teamId: string;
  projectId: string;
  kind: string;
  question: string;
  options: TeamAttentionOption[];
  requestedAt: string;
  timeoutAt: string;
  /** Server-resolved deadline state — mirrors `timeoutAt` against the controller clock. */
  overdue: boolean;
  resolved: boolean;
  resolvedVia: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  freeform: boolean;
  notified: TeamAttentionNotified | null;
  roomId: string;
  /** Relative workbench link the controller suggests (`/projects/{id}/tasks/{taskId}`). */
  url: string;
}

export interface TeamAttentionResponse {
  /** Team name from the URL (the CR name). */
  team_id: string;
  items: TeamAttentionItem[];
  /** Rows actually returned, not the rows that matched the filter. */
  count: number;
  /** `true` when the filter matched more rows than `limit`. */
  truncated: boolean;
}

export interface HumanResponse {
  systemAdmin?: boolean;
  name: string;
  phase: HumanPhase;
  displayName: string;
  matrixUserID: string;
  initialPassword: string;
  rooms: string[];
  message: string;
  permissionLevel?: number;
  accessibleTeams?: string[];
  accessibleWorkers?: string[];
  groupAllowFrom?: string[];
  email?: string;
  note?: string;
}

/**
 * GET /humans/{name}/quota 响应。quotaBytes null = 无限制，0 = 零额度；
 * quotaFiles 为前向兼容字段（当前 Controller 未实现，缺省 = 不限）。
 */
export interface HumanQuotaResponse {
  usedBytes: number;
  quotaBytes: number | null;
  quotaFiles?: number | null;
}

export interface SetHumanQuotaRequest {
  quotaBytes: number | null;
  quotaFiles?: number | null;
}

/**
 * 人 CR 的配置面回读：GET /humans/{name} 的 flat 响应（HumanResponse）可能
 * 额外带 modelAccess / workspaceAccess / capabilities；整体 CR 形状则把
 * spec 嵌在 spec 下。两形状都兼容，写面按在场形状原样带回。
 */
export interface HumanConfigRecord extends HumanResponse {
  capabilities?: string[];
  modelAccess?: unknown;
  workspaceAccess?: unknown;
  spec?: Record<string, unknown>;
}

export interface ModelAccessTablesResponse {
  tables?: string[];
  items?: unknown[];
  names?: string[];
}

export interface SaveHumanConfigResult {
  method: 'PUT' | 'PATCH';
}

export interface SaveHumanWorkspaceAccessResult extends SaveHumanConfigResult {
  /** re-GET 是否回读到所存内容（控制器不回显该字段时为 false）。 */
  verified: boolean;
  current: WorkspaceAccess | null;
}

/** ManagerSpec.Config（controller v1beta1.ManagerConfig）——Manager 独有的运行
 * 调参。PUT 的 config 是整对象替换（UpdateManager：req.Config != nil 整体写），
 * 空串 = 回退 Controller 默认（15m / 720m / admin-dm）。 */
export interface ManagerConfigInfo {
  heartbeatInterval?: string;
  workerIdleTimeout?: string;
  notifyChannel?: string;
}

/** Manager 的 MCP server 声明（spec.mcpServers）。 */
export interface ManagerMcpServer {
  name: string;
  url: string;
  transport?: string;
}

export interface ManagerResponse {
  name: string;
  phase: ManagerPhase;
  state: ManagerState;
  model: RequestModelAlias;
  /** APIG Model API 名（spec.modelProvider）；空 = 跟随默认。 */
  modelProvider?: string;
  runtime: string;
  image: string;
  matrixUserID: string;
  roomID: string;
  leaderDMRoomID?: string;
  version: string;
  message: string;
  welcomeSent: boolean;
  /* ── ManagerSpec 配置面 ──────────────────────────────────────────────
   * controller 的 managerToResponse 目前只映射标量列，详情响应同样不带这些
   * 字段；后端补齐后自动点亮，缺省时抽屉诚实降级为「未配置」。 */
  soul?: string;
  agents?: string;
  skills?: string[];
  mcpServers?: ManagerMcpServer[];
  env?: Record<string, string>;
  config?: ManagerConfigInfo;
}

// ----- human file sync (upstream #1499) -----
//
// Read-only view of the per-human sync manifest. The manifest PUT is the
// file-sync client's job; the dashboard only reports generation, timestamps,
// entry counts and the write-base ETag.

export interface HumanSyncStatus {
  entries: number;
  tombstones: number;
  generation: number;
  updatedAt: string;
  updatedBy: string;
}

export interface HumanSyncManifest {
  version: number;
  generation: number;
  entries: Record<string, unknown>;
  tombstones: unknown[];
  updatedAt: string;
  updatedBy: string;
}

export interface HumanSyncManifestRead {
  manifest: HumanSyncManifest;
  /** Storage ETag of the stored manifest — the base for a later If-Match. */
  etag: string | null;
}

// ----- plugin registries / module index (upstream #1526) -----
//
// The controller projects only the pinned plugin metadata fields
// (id, name, version, description, author, enabled, loaded, plugin_type,
// frontend_entry); every field is optional because upstream drift is
// tolerated on the whitelist only.

export interface PluginMetadataEntry {
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  enabled?: boolean;
  loaded?: boolean;
  plugin_type?: string;
  frontend_entry?: string;
}

export interface TeamModuleMember {
  worker: string;
  version?: string;
  loaded: boolean;
}

export interface TeamModuleView {
  module: string;
  name?: string;
  kind?: string;
  versions: Record<string, number>;
  members: TeamModuleMember[];
  consistent: boolean;
}

export interface TeamModulesResponse {
  team: string;
  modules: TeamModuleView[];
  errors?: Array<{ worker: string; error: string }>;
}

export interface MillforgeArtifact {
  name: string;
  sha256: string;
}

export interface MillforgeVersion {
  artifacts?: MillforgeArtifact[];
  requires?: Record<string, string>;
  commit?: string;
  published_at?: string;
  deprecated?: boolean;
}

export interface MillforgeModuleEntry {
  kind?: string;
  pluginId?: string;
  latest?: string | null;
  versions?: Record<string, MillforgeVersion>;
  note?: string;
}

export interface MillforgeIndex {
  schema: number;
  channel: string;
  modules: Record<string, MillforgeModuleEntry>;
  source: string;
  repo: string;
  fetched_at: string;
}

export interface MillforgeIndexQuery {
  source?: 'github' | 'gitcode';
  repo?: string;
  ref?: string;
  channel?: 'alpha' | 'beta' | 'stable';
}

/** Install/update request shared by the team, worker and manager planes. */
export interface ModuleInstallRequest {
  module: string;
  source: 'github' | 'gitcode';
  repo?: string;
  ref?: string;
  channel?: 'alpha' | 'beta' | 'stable';
  version?: string;
  artifact?: string;
  sha256?: string;
}

export interface ModuleInstallResult {
  installed?: boolean;
  loaded?: boolean;
  previous_version?: string;
  updated?: string[];
  target_version?: string;
  failed?: Record<string, string>;
  [key: string]: unknown;
}

// ----- 千锻（Millforge）编译/注入域 -----
//
// 契约 = agentteams_connector/millforge_api.py（工作台插件同一后端）：源配置 →
// 导入 pack → 模板编译 → SOUL 注入 → LLM 二次生成。仪表盘只消费，不改契约。
// 旧 Controller 无这些路由（404/405）→ 面板按「控制器不支持」降级。

/** GET/PUT /millforge/source（custom_url 空 = 按 kind+repo 派生 URL）。 */
export interface MillforgeSource {
  kind: 'github' | 'gitcode';
  repo: string;
  custom_url: string;
  resolved_url: string;
  updated_at?: string;
}

export interface MillforgeSourcePatch {
  kind?: string;
  repo?: string;
  custom_url?: string;
}

/** POST /millforge/import（整包覆盖导入）。 */
export interface MillforgeImportResult {
  ok: boolean;
  pack: string;
  url: string;
  ref: string;
  commit: string;
  files: number;
  has_compiler: boolean;
  has_core: boolean;
}

/** INDEX.yaml 单条目（skeletons/industry/domain/fragments 同构）。 */
export interface MillforgePackEntry {
  id: string;
  file: string;
  source?: string;
  applies_to?: string;
  /** domain 条目 → 所属行业（行业→领域级联过滤；旧包无此字段 → 回退全显）。 */
  industry?: string;
  budget?: string;
}

/** INDEX 整队组合（teams 段；选中自动填 members/domains）。 */
export interface MillforgeTeamCombo {
  id: string;
  name: string;
  industry: string;
  members: { leader: string; workers: string; critic: string };
  domains: string;
  source: string;
  experimental: string;
}

/** 解析后的 pack INDEX（null = 该包 INDEX 解析失败）。 */
export interface MillforgePackIndex {
  skeletons: MillforgePackEntry[];
  industry: MillforgePackEntry[];
  domain: MillforgePackEntry[];
  fragments: MillforgePackEntry[];
  teams: MillforgeTeamCombo[];
}

/** 单个模板包（pack 名 = 仓库 slug）。 */
export interface MillforgePack {
  pack: string;
  meta: {
    url: string;
    ref: string;
    commit: string;
    imported_at: string;
    files?: string[];
  } | null;
  index: MillforgePackIndex | null;
  parse_error?: string | null;
}

export interface MillforgePacksResponse {
  packs: MillforgePack[];
}

/** GET /millforge/packs/{pack}/file（.md/.yaml/.json/.py/.sh/.txt 只读预览）。 */
export interface MillforgePackFile {
  pack: string;
  path: string;
  size: number;
  content: string;
}

/** 模板路径输入（INDEX 整队组合或 industry+domains+members 确定性组装）。 */
export interface MillforgeTemplateSpec {
  team_combo?: string;
  industry?: string;
  domains?: string[];
  members?: { leader?: number; workers?: number; critic?: number };
}

/** 编译请求：template 与 team_json 恰好给一个。 */
export interface MillforgeCompileRequest {
  pack: string;
  team: string;
  lang: 'zh' | 'en';
  template?: MillforgeTemplateSpec;
  team_json?: Record<string, unknown>;
}

export interface MillforgeRoleOut {
  role: string;
  kind: 'coordinator' | 'leader' | 'worker' | 'critic';
  lines: number;
  budget: number;
  budget_ok: boolean;
  soul_sha256: string;
  soul: string;
}

/** POST /millforge/compile 成功响应（build 落盘 + 全量 SOUL 预览）。 */
export interface MillforgeBuildResult {
  ok: boolean;
  build_id: string;
  pack: string;
  team: string;
  lang: string;
  source: 'template' | 'custom';
  roles: MillforgeRoleOut[];
  fragments: string[];
  spawn_specs: string[];
  provenance: Record<string, unknown>;
}

/** create_workers 行（CR 角色 team_leader/worker）。 */
export interface MillforgeCreateWorker {
  name: string;
  role_id: string;
  role?: string;
  model?: string;
  runtime?: string;
}

/** POST /millforge/inject 请求（mapping 与 create_workers 二选一语义）。 */
export interface MillforgeInjectRequest {
  build_id: string;
  team: string;
  mapping: Record<string, string>;
  create_workers: MillforgeCreateWorker[];
  core_skill: boolean;
  apply_soul: boolean;
  /** 目标已有内容不同的 SOUL 时 true = 确认覆盖（未确认 → 后端 409）。 */
  overwrite?: boolean;
}

/** 注入单项结果（souls / created 同构）。 */
export interface MillforgeInjectEntry {
  worker?: string;
  name?: string;
  role_id: string;
  /** unchanged = 内容相同已跳过。 */
  status: 'ok' | 'unchanged' | 'error';
  error?: string;
  verified?: boolean;
  mode?: 'apply' | 'overwrite' | 'unchanged' | 'rollback';
  prev_sha256?: string;
  prev_provenance?: Record<string, string | boolean>;
}

/** POST /millforge/inject/preflight 单项（只读）。 */
export interface MillforgePreflightTarget {
  worker: string;
  role_id: string;
  state: 'empty' | 'same' | 'differs' | 'error';
  prev_sha256?: string;
  new_sha256?: string;
  prev_provenance?: Record<string, string | boolean>;
  prev_head?: string;
  prev_len?: number;
  error?: string;
}

export interface MillforgePreflightResult {
  build_id: string;
  targets: MillforgePreflightTarget[];
  conflict_count: number;
}

/** POST /millforge/inject 响应（HTTP 200 + partial 如实回报逐项成败）。 */
export interface MillforgeInjectResult {
  ok: boolean;
  partial: boolean;
  build_id: string;
  team: string;
  souls: MillforgeInjectEntry[];
  created: MillforgeInjectEntry[];
  core_skill: {
    status: 'ok' | 'partial' | 'error' | 'skipped';
    skill?: string;
    assigned?: string[];
    detail?: string;
  };
}

/** GET /millforge/injections 历史条目（留 50，最新在前）。 */
export interface MillforgeInjectionRec {
  id: string;
  at: string;
  build_id: string;
  team: string;
  partial: boolean;
  souls: MillforgeInjectEntry[];
  created: MillforgeInjectEntry[];
  core_skill: MillforgeInjectResult['core_skill'];
}

export interface MillforgeInjectionsResponse {
  injections: MillforgeInjectionRec[];
}

/** POST /millforge/prompt 表单（空字段 = 提示词标注「未提供」）。 */
export interface MillforgePromptForm {
  members: string;
  task_types: string;
  runtime: string;
  pains: string;
  team_name: string;
}

export interface MillforgePromptResult {
  ok: boolean;
  pack: string;
  prompt: string;
}

/** 字段级校验错误（jsonschema 路径 + 消息）。 */
export interface MillforgeParseError {
  path: string;
  message: string;
}

/** POST /millforge/parse-team-json 响应（ok=true 时 team = 校验后的 team.json）。 */
export interface MillforgeParseResult {
  ok: boolean;
  team?: Record<string, unknown>;
  errors?: MillforgeParseError[];
}

export interface MillforgeRollbackResult {
  ok: boolean;
  worker: string;
  restored_sha256: string;
  backup_at?: string;
  verified: boolean;
}

export interface CreateWorkerRequest {
  name: string;
  model?: RequestModelAlias;
  /** APIG Model API name；空 = 跟随默认。 */
  modelProvider?: string;
  runtime: WorkerRuntime;
  image?: string;
  soul?: string;
  agents?: string;
  skills?: string[];
  mcpServers?: { name: string; url: string; transport: string }[];
  package?: string;
  state?: WorkerState;
  containerManaged?: boolean;
}

// LLM 调优（#146 缺口 3）：空串 = 清除回默认；缺省 = 不改动。
export interface UpdateWorkerRequest extends LlmTuningFields {
  env?: Record<string, string>;
  model?: RequestModelAlias;
  /** APIG Model API name；缺省 = 保持控制器现值（合并语义）。 */
  modelProvider?: string;
  runtime?: WorkerRuntime;
  image?: string;
  soul?: string;
  agents?: string;
  skills?: string[];
  mcpServers?: { name: string; url: string; transport: string }[];
  package?: string;
  state?: WorkerState;
  containerManaged?: boolean;
}

export interface CreateTeamRequest extends LlmTuningFields {
  name: string;
  teamName?: string;
  description?: string;
  leader?: { name: string };
  admin?: { name: string };
  workerNames?: string[];
  humanMembers?: string[];
  /** Default model for newly provisioned worker members. */
  defaultWorkerModel?: RequestModelAlias;
  /** Default runtime for newly provisioned worker members. */
  defaultWorkerRuntime?: WorkerRuntime;
  /** TeamSpec.heartbeatEvery（如 "10m"）。 */
  heartbeatEvery?: string;
  /** TeamSpec.subagentModel（子代理默认模型；留空 = 继承各 Worker 主模型）。 */
  subagentModel?: string;
  /** TeamSpec.peerMentions（删除撤销按快照重建时保留原值）。 */
  peerMentions?: boolean;
}

export interface UpdateTeamRequest extends LlmTuningFields {
  teamName?: string;
  description?: string;
  leader?: { name: string } | null;
  admin?: { name: string } | null;
  workerNames?: string[];
  humanMembers?: string[];
  defaultWorkerModel?: RequestModelAlias;
  defaultWorkerRuntime?: WorkerRuntime;
  /**
   * TeamSpec.workerIdleTimeout（默认 720m）。注意：controller v1.2.x 的
   * UpdateTeamRequest 尚未接收该字段（PUT 会忽略）——保存后回读不一致时
   * 抽屉会明示「服务端未应用」。
   */
  workerIdleTimeout?: string;
  /** TeamSpec.peerMentions（指针语义：省略 = 不改）。 */
  peerMentions?: boolean;
  /** TeamSpec.heartbeatEvery；null = 清空回 Controller 默认（与插件 doCfg 同语义）。 */
  heartbeatEvery?: string | null;
  /** TeamSpec.subagentModel；null = 清空（继承各 Worker 主模型）。 */
  subagentModel?: string | null;
}

export type TeamWorkerMember = { name: string; role: 'team_leader' | 'worker' };

// Controller contract (v1.2.0): teams are created/updated with workerMembers
// ([{name, role}], exactly one role=team_leader, no duplicates). The dashboard
// UI works with leader + workerNames; map them to workerMembers here.
export function buildWorkerMembers(
  leader: { name: string } | null | undefined,
  workerNames: string[] | undefined,
): TeamWorkerMember[] {
  const members: TeamWorkerMember[] = [];
  const seen = new Set<string>();
  const push = (name: string, role: TeamWorkerMember['role']) => {
    const trimmed = name.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      members.push({ name: trimmed, role });
    }
  };
  if (leader?.name) push(leader.name, 'team_leader');
  for (const name of workerNames ?? []) push(name, 'worker');
  return members;
}

/**
 * Controller contract: every workerMembers reference (including the team_leader)
 * must map to an already-existing Worker resource — team creation does not
 * provision members. Ensure each member exists before creating the team, and
 * create the missing ones with the minimal Worker payload (name + runtime,
 * optionally a default model when the caller supplies one).
 */
export async function ensureWorkersExist(
  members: TeamWorkerMember[],
  options: { defaultModel?: RequestModelAlias; defaultRuntime?: WorkerRuntime } = {},
): Promise<void> {
  const existing = await agentteamsApi.listWorkers();
  const existingNames = new Set(existing.map((worker) => worker.name));
  const missing = [...new Set(members.map((member) => member.name))]
    .filter((name) => name && !existingNames.has(name));
  const runtime = options.defaultRuntime ?? ('openclaw' as WorkerRuntime);
  for (const name of missing) {
    const payload: { name: string; runtime: WorkerRuntime; model?: RequestModelAlias } = {
      name,
      runtime,
    };
    if (options.defaultModel) payload.model = options.defaultModel;
    await proxyRequest<WorkerResponse>('/workers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
}

export interface CreateHumanRequest {
  name: string;
  displayName: string;
  email?: string;
  permissionLevel?: 1 | 2 | 3;
  accessibleTeams?: string[];
  accessibleWorkers?: string[];
  note?: string;
}

export interface UpdateHumanRequest {
  displayName?: string;
  email?: string;
  permissionLevel?: 1 | 2 | 3;
  accessibleTeams?: string[];
  accessibleWorkers?: string[];
  note?: string;
}

export interface CreateManagerRequest {
  name: string;
  model?: RequestModelAlias;
  /** APIG Model API name；空 = 跟随默认。 */
  modelProvider?: string;
  runtime?: string;
  image?: string;
}

export interface UpdateManagerRequest {
  model?: RequestModelAlias;
  modelProvider?: string;
  runtime?: string;
  image?: string;
  /** 文档（Controller 仅应用非空值——空串无法清除既有内容）。 */
  soul?: string;
  agents?: string;
  /** 非 nil = 整表替换（空数组 = 清空）。 */
  skills?: string[];
  /** 非 nil = 整表替换（空数组 = 清空）。 */
  mcpServers?: ManagerMcpServer[];
  /**
   * 环境变量（整表替换）。注意：controller 的 UpdateManagerRequest 目前没有
   * env 字段，PUT 会静默忽略——抽屉保存后回读不一致会明示「未生效」，不假装成功。
   */
  env?: Record<string, string>;
  /** 整对象替换；空串 = 回退默认。 */
  config?: ManagerConfigInfo;
  /** 期望生命周期状态（desired-state 语义）。 */
  state?: ManagerState;
}

// Matches the controller's snake_case schema (agentteams-controller internal/server/types.go):
// request {name, credential_key}, response {name, consumer_id, api_key, status}.
export interface CreateConsumerRequest {
  name: string;
  credential_key?: string;
}

export interface ConsumerResponse {
  name: string;
  consumer_id?: string;
  api_key?: string;
  status?: string;
}

export interface ClusterStatus {
  kubeMode: boolean;
  totalWorkers: number;
  totalTeams: number;
  totalHumans: number;
}

export interface VersionInfo {
  controller: string;
  kubeMode: boolean;
}

// AgentTeams v1.2.0+ returns kubeMode as a string ('embedded' | 'incluster')
// while older versions returned a boolean. Normalize to boolean so that
// consumers can rely on truthiness ('embedded' is a truthy string).
export function normalizeKubeMode(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'incluster' || value === 'k8s';
  return false;
}

export type ExternalServiceState = 'unconfigured' | 'reachable' | 'unreachable';

export interface ExternalServiceStatus {
  configured: boolean;
  endpoint?: string;
  state: ExternalServiceState;
  httpStatus?: number;
  error?: string;
}

export interface HigressStatus {
  mode: 'direct' | 'external';
  gateway: ExternalServiceStatus;
  console: ExternalServiceStatus;
  healthy: boolean;
}

export interface InfrastructureInfo {
  minio?: { healthy: boolean; endpoint: string; buckets: string[] };
  higress?: HigressStatus;
  matrix?: { healthy: boolean; homeserver: string };
  kubernetes?: { healthy: boolean; version: string };
  controller?: { healthy: boolean; version: string };
  /** Optional SGLang inference backend (F1). endpoint is empty when not configured. */
  sglang?: { healthy: boolean; endpoint: string };
}

export interface BucketResponse {
  name: string;
  createdAt?: string;
}

export interface StorageObject {
  key: string;
  size: number;
  lastModified?: string;
  etag?: string;
  isPrefix?: boolean;
}

export interface PresignUploadResponse {
  url: string;
  fields?: Record<string, string>;
}

export interface PresignDownloadResponse {
  url: string;
}

export interface McpServerConfig {
  name: string;
  url: string;
  transport: 'sse' | 'streaminghttp';
  type?: 'streamable-http-proxy' | 'sse-proxy' | 'rest-to-mcp';
  timeout?: number;
  headers?: Record<string, string>;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface McpTestResult {
  success: boolean;
  message: string;
  statusCode?: number;
  latencyMs?: number;
}

export interface McpServerListResponse {
  servers: McpServerConfig[];
}

export interface WorkerSkillsListResponse {
  skills: string[];
}

export interface WorkerSkillUploadResponse {
  success: boolean;
  skillName: string;
  description: string;
  filesCount: number;
  prefix: string;
  note?: string;
}

export interface LogLine {
  timestamp: string;
  level: string;
  component: string;
  message: string;
}

// ============ Proxy Request Helper ============

async function proxyRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const requestScope = currentReadScope();
  let res: Response;
  try {
    res = await conditionalFetch(apiUrl(`/api/agentteams${path}`), {
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new NetworkError(path, err);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(
      `API Error ${res.status}: ${text || res.statusText}`,
      res.status,
      path
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text().catch(() => '');
    throw new ApiError(
      `API returned non-JSON response (${contentType}): ${text.slice(0, 200)}`,
      res.status,
      path
    );
  }

  try {
    const data = await res.json();
    if (currentReadScope() !== requestScope) throw new ApiError('账号或连接已切换，请重新读取', 409, path);
    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const message = err instanceof Error ? err.message : 'unknown';
    throw new ApiError(
      `Failed to parse API JSON response: ${message}`,
      res.status,
      path,
      err
    );
  }
}

async function healthRequest(controllerUrl: string): Promise<string> {
  const path = controllerUrl.trim()
    ? `/api/agentteams/healthz/?controllerUrl=${encodeURIComponent(controllerUrl)}`
    : '/api/agentteams/healthz/';
  const res = await fetch(apiUrl(path), { method: 'GET' });
  if (!res.ok) throw new ApiError(`Health check failed: ${res.status}`, res.status, '/healthz');
  return res.text();
}

// 编码执行记录（#146 缺口 2；上游 v2 契约 @ agentscope-ai/AgentTeams#1381）。
// 列表项基础字段为 v1 {task_id, run, team?}；v2 元数据为加性字段，来自每个
// task 的 runs.jsonl 索引，未记录时上游省略（旧 run 降级为 v1）。
//
// 注意：上游最终契约**不**从 run 文件名推导 started_at（文件名是容器本地时间，
// 上游明确拒绝把本地时间当 UTC 呈现）。因此 started_at 仅在有 runs.jsonl 记录
// 时出现；缺省即“未知”，前端不应伪造。
export interface CodingRun {
  task_id: string;
  run: string;
  team?: string;
  cli?: string;
  worker?: string;
  status?: CodingRunStatus;
  exit_code?: number;
  started_at?: string;
  ended_at?: string;
  log_bytes?: number;
}

export type CodingRunStatus = 'ok' | 'failed' | 'timeout' | 'blocked';

// 详情 ?format=json 信封（上游 codingRunDetail）。meta 无记录时为空对象，
// input.prompt_available 表示 prompt 是否已镜像可读，output.transcript 为原始日志。
export interface CodingRunMeta {
  cli?: string;
  worker?: string;
  runner?: string;
  status?: CodingRunStatus;
  reason?: string;
  exit_code?: number;
  timeout_secs?: number;
  started_at?: string;
  ended_at?: string;
  log_bytes?: number;
  prompt_file?: string;
  prompt_sha256?: string;
}

export interface CodingRunInput {
  prompt_summary?: string;
  prompt_sha256?: string;
  prompt?: string;
  prompt_available: boolean;
}

export interface CodingRunOutput {
  transcript: string;
  status?: CodingRunStatus;
  exit_code?: number;
}

export interface CodingRunDetail {
  task_id: string;
  run: string;
  team?: string;
  meta: CodingRunMeta;
  input: CodingRunInput;
  output: CodingRunOutput;
}

/**
 * 拉取单条编码执行记录详情。format='json' 时上游返回结构化信封（v2），
 * 缺省（不传）返回原始 text/plain。本地校验同路由一致：非 2xx 抛 ApiError。
 */
async function fetchCodingRunDetail(
  taskId: string,
  run: string,
  team?: string,
  format?: 'json',
): Promise<Response> {
  const params = new URLSearchParams();
  if (team) params.set('team', team);
  if (format) params.set('format', format);
  const qs = params.toString();
  const path = `/coding-runs/${encodeURIComponent(taskId)}/runs/${encodeURIComponent(run)}${qs ? `?${qs}` : ''}`;
  let res: Response;
  try {
    res = await fetch(apiUrl(`/api/agentteams${path}`), { cache: 'no-store' });
  } catch (err) {
    throw new NetworkError(path, err);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(
      `API Error ${res.status}: ${text || res.statusText}`,
      res.status,
      path,
    );
  }
  return res;
}

/**
 * Read one human's sync manifest together with its storage ETag. The ETag is
 * a response header (the write base for a later If-Match), so this read needs
 * the raw Response rather than proxyRequest.
 */
async function fetchHumanSyncManifest(name: string): Promise<HumanSyncManifestRead> {
  const path = `/humans/${encodeURIComponent(name)}/sync/manifest`;
  let res: Response;
  try {
    res = await fetch(apiUrl(`/api/agentteams${path}`), { cache: 'no-store' });
  } catch (err) {
    throw new NetworkError(path, err);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(
      `API Error ${res.status}: ${text || res.statusText}`,
      res.status,
      path,
    );
  }
  const manifest = (await res.json()) as HumanSyncManifest;
  return { manifest, etag: res.headers.get('etag') };
}

// ----- human configuration writes (quota / modelAccess / workspaceAccess) -----
//
// PUT /humans/{name} is merge-patch: absent = unchanged, present = replace.
// The two spec-object fields need read-modify-write (read the record, replace
// only the target field, send the rest back untouched) so a partially
// supported controller never loses sibling configuration. PUT 404/405 means
// the endpoint is missing on an older controller → PATCH merge-patch fallback.

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isUnsupportedWrite(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 405);
}

async function writeHumanConfig(
  name: string,
  buildBody: (_record: Record<string, unknown>) => Record<string, unknown>,
  buildPatch: (_record: Record<string, unknown>) => Record<string, unknown>,
): Promise<SaveHumanConfigResult> {
  const path = `/humans/${encodeURIComponent(name)}`;
  const record = asRecord(await proxyRequest<unknown>(path));
  if (!record) throw new Error('人 CR 读取结果非法（期望对象）');
  try {
    await proxyRequest<unknown>(path, {
      method: 'PUT',
      body: JSON.stringify(buildBody(record)),
    });
    return { method: 'PUT' };
  } catch (err) {
    if (!isUnsupportedWrite(err)) throw err;
    await proxyRequest<unknown>(path, {
      method: 'PATCH',
      body: JSON.stringify(buildPatch(record)),
    });
    return { method: 'PATCH' };
  }
}

/**
 * 保存 spec.modelAccess（读-改-写，只改该字段）。
 * payload = null（无有效作用域）→ 发送空 scopes：该 Controller 以空 spec
 * 表示全锁（fail-closed），删键在 merge-patch 下反而不会清空。
 */
export async function saveHumanModelAccess(
  name: string,
  payload: Record<string, unknown> | null,
): Promise<SaveHumanConfigResult> {
  const value = payload ?? { scopes: [] };
  return writeHumanConfig(
    name,
    (record) => {
      const spec = asRecord(record.spec);
      return spec
        ? { ...record, spec: { ...spec, modelAccess: value } }
        : { ...record, modelAccess: value };
    },
    (record) =>
      asRecord(record.spec)
        ? { spec: { modelAccess: value } }
        : { modelAccess: value },
  );
}

/**
 * 保存 spec.workspaceAccess（读-改-写，只改该字段）→ re-GET 验证。
 * 当前 Controller 的 GET /humans/{name} 不回显 workspaceAccess（write-only）
 * 时 verified = false，调用方按「未回读」告警而不是断言保存失败。
 */
export async function saveHumanWorkspaceAccess(
  name: string,
  access: WorkspaceAccess,
): Promise<SaveHumanWorkspaceAccessResult> {
  const payload = buildWorkspaceAccessPayload(access); // {} = 清空两列表
  const result = await writeHumanConfig(
    name,
    (record) => {
      const spec = asRecord(record.spec);
      return spec
        ? { ...record, spec: { ...spec, workspaceAccess: payload } }
        : { ...record, workspaceAccess: payload };
    },
    (record) =>
      asRecord(record.spec)
        ? { spec: { workspaceAccess: payload } }
        : { workspaceAccess: payload },
  );
  const verify = await proxyRequest<HumanConfigRecord>(
    `/humans/${encodeURIComponent(name)}`,
  );
  const current = extractWorkspaceAccess(verify);
  return { ...result, verified: workspaceAccessEqual(current, access), current };
}

/** 共享模型授权表清单（404 / 缺 CRD → supported=false，隐藏表选择器）。 */
export async function listModelAccessTables(): Promise<{
  supported: boolean;
  tables: string[];
}> {
  try {
    const body = await proxyRequest<
      ModelAccessTablesResponse | string[] | unknown[]
    >('/model-access-tables');
    const record = asRecord(body);
    const list: unknown = Array.isArray(body)
      ? body
      : (record?.items ?? record?.tables ?? record?.names);
    const tables: string[] = [];
    if (Array.isArray(list)) {
      for (const item of list) {
        const entry = asRecord(item);
        const name =
          typeof item === 'string'
            ? item
            : ((asRecord(entry?.metadata)?.name ?? entry?.name) as unknown);
        if (typeof name === 'string' && name.trim() !== '' && !tables.includes(name)) {
          tables.push(name);
        }
      }
    }
    return { supported: true, tables };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { supported: false, tables: [] };
    }
    if (
      err instanceof ApiError &&
      err.status === 500 &&
      /no matches for kind/i.test(err.message) &&
      /modelaccesstable/i.test(err.message)
    ) {
      return { supported: false, tables: [] };
    }
    throw err;
  }
}

// ============ API Methods ============

export const agentteamsApi = {
  // Health & Status
  checkHealth: (controllerUrl: string) => healthRequest(controllerUrl),

  getStatus: async (): Promise<ClusterStatus> => {
    const raw = await proxyRequest<ClusterStatus>('/cluster-status');
    return { ...raw, kubeMode: normalizeKubeMode(raw.kubeMode) };
  },

  getVersion: async (): Promise<VersionInfo> => {
    const raw = await proxyRequest<VersionInfo>('/version');
    return { ...raw, kubeMode: normalizeKubeMode(raw.kubeMode) };
  },

  // Workers
  listWorkers: async (): Promise<WorkerResponse[]> => {
    const result = await proxyRequest<WorkerResponse[] | { workers: WorkerResponse[]; total: number }>('/workers');
    if (!result || typeof result !== 'object') return [];
    return Array.isArray(result) ? result : (result.workers ?? []);
  },

  // Poll projections only; full configuration stays on listWorkers/getWorker.
  listWorkerSummaries: async (): Promise<WorkerResponse[]> => {
    type Rows = WorkerResponse[] | { workers: WorkerResponse[] };
    const rows = (result: Rows) => Array.isArray(result) ? result : result.workers ?? [];
    try {
      const [spec, status] = await Promise.all([
        proxyRequest<Rows>('/workers?fields=spec'),
        proxyRequest<Rows>('/workers?fields=status'),
      ]);
      let byName = new Map(rows(spec).map((worker) => [worker.name, worker]));
      const live = rows(status);
      if (live.some((worker) => !byName.has(worker.name))) {
        const fresh = await proxyRequest<Rows>('/workers?fields=spec', { cache: 'reload' });
        byName = new Map(rows(fresh).map((worker) => [worker.name, worker]));
        if (live.some((worker) => !byName.has(worker.name))) {
          return rows(await proxyRequest<Rows>('/workers?fields=spec,status'));
        }
      }
      // Status is authoritative for membership: removed Workers must disappear.
      return live.map((worker) => ({ ...byName.get(worker.name), ...worker }));
    } catch (error) {
      // Old Controllers either ignore fields (already compatible above) or reject it.
      if (error instanceof ApiError && error.status === 400) return agentteamsApi.listWorkers();
      throw error;
    }
  },

  getWorker: (name: string) => proxyRequest<WorkerResponse>(`/workers/${encodeURIComponent(name)}`),

  createWorker: (data: CreateWorkerRequest) =>
    proxyRequest<WorkerResponse>('/workers', { method: 'POST', body: JSON.stringify(data) }),

  updateWorker: (name: string, data: UpdateWorkerRequest) =>
    proxyRequest<WorkerResponse>(`/workers/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteWorker: (name: string) =>
    proxyRequest<void>(`/workers/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  wakeWorker: (name: string) =>
    proxyRequest<{ name: string; phase: string }>(`/workers/${encodeURIComponent(name)}/wake`, { method: 'POST' }),

  sleepWorker: (name: string) =>
    proxyRequest<{ name: string; phase: string }>(`/workers/${encodeURIComponent(name)}/sleep`, { method: 'POST' }),

  ensureReadyWorker: (name: string) =>
    proxyRequest<{ name: string; phase: string }>(`/workers/${encodeURIComponent(name)}/ensure-ready`, { method: 'POST' }),

  getWorkerStatus: (name: string) =>
    proxyRequest<WorkerResponse>(`/workers/${encodeURIComponent(name)}/status`),

  // Teams
  listTeams: async (): Promise<TeamResponse[]> => {
    const result = await proxyRequest<TeamResponse[] | { teams: TeamResponse[] }>('/teams');
    if (!result || typeof result !== 'object') return [];
    return Array.isArray(result) ? result : (result as { teams: TeamResponse[] }).teams ?? [];
  },

  getTeam: (name: string) => proxyRequest<TeamResponse>(`/teams/${encodeURIComponent(name)}`),

  /**
   * Team attention inbox (upstream #1503, read-only).
   *
   * `status`: `open` (default) | `overdue` | `resolved` | `all`; anything else
   * is a controller 400. `limit`: 1..1000 (default 200) — above/below is a
   * 400, never a clamp. 404 means either the team is unreadable (existence
   * hidden) or the Controller predates #1503, so callers render the upgrade
   * placeholder via `isUnsupportedEndpointError`.
   */
  getTeamAttention: async (
    name: string,
    options: { status?: 'open' | 'overdue' | 'resolved' | 'all'; limit?: number } = {},
  ): Promise<TeamAttentionResponse> => {
    const params = new URLSearchParams();
    if (options.status) params.set('status', options.status);
    if (options.limit) params.set('limit', String(options.limit));
    const qs = params.toString();
    return proxyRequest<TeamAttentionResponse>(
      `/teams/${encodeURIComponent(name)}/attention${qs ? `?${qs}` : ''}`,
    );
  },

  createTeam: async (data: CreateTeamRequest) => {
    // 兼容旧字段 admin：Controller 实际接收的是 leader.name（workerMembers 中的 team_leader）
    const { workerNames, leader, defaultWorkerModel, defaultWorkerRuntime, ...rest } = data;
    const payload: Record<string, unknown> = { ...rest };
    if (payload.admin && !leader) {
      payload.leader = payload.admin;
    }
    const workerMembers = buildWorkerMembers(leader, workerNames);
    await ensureWorkersExist(workerMembers, {
      defaultModel: defaultWorkerModel,
      defaultRuntime: defaultWorkerRuntime,
    });
    payload.workerMembers = workerMembers;
    delete payload.leader;
    delete payload.workerNames;
    delete payload.defaultWorkerModel;
    delete payload.defaultWorkerRuntime;
    return proxyRequest<TeamResponse>('/teams', { method: 'POST', body: JSON.stringify(payload) });
  },

  updateTeam: async (name: string, data: UpdateTeamRequest) => {
    const { workerNames, leader, admin, defaultWorkerModel, defaultWorkerRuntime, ...rest } = data;
    const payload: Record<string, unknown> = { ...rest };
    if (admin !== undefined) payload.admin = admin;
    if (workerNames !== undefined) {
      const workerMembers = buildWorkerMembers(leader ?? undefined, workerNames);
      await ensureWorkersExist(workerMembers, {
        defaultModel: defaultWorkerModel,
        defaultRuntime: defaultWorkerRuntime,
      });
      payload.workerMembers = workerMembers;
    }
    delete payload.leader;
    delete payload.workerNames;
    delete payload.defaultWorkerModel;
    delete payload.defaultWorkerRuntime;
    return proxyRequest<TeamResponse>(`/teams/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(payload) });
  },

  deleteTeam: (name: string) =>
    proxyRequest<void>(`/teams/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  // 编码执行记录（#146 缺口 2，只读）
  listCodingRuns: () => proxyRequest<CodingRun[]>('/coding-runs'),

  // 原始日志（v1 默认 text/plain，字节透传）。
  getCodingRunLog: (taskId: string, run: string, team?: string): Promise<string> =>
    fetchCodingRunDetail(taskId, run, team).then((res) => res.text()),

  // 详情视图：优先 v2 ?format=json 结构化信封；旧 Controller（忽略 format）
  // 仍返回 text/plain，此时降级为原始日志（detail=null, text=原始内容）。
  getCodingRunView: async (
    taskId: string,
    run: string,
    team?: string,
  ): Promise<{ detail: CodingRunDetail | null; text: string }> => {
    const res = await fetchCodingRunDetail(taskId, run, team, 'json');
    const text = await res.text();
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        const detail = JSON.parse(text) as CodingRunDetail;
        if (detail && typeof detail === 'object' && detail.output) {
          return { detail, text: detail.output.transcript ?? '' };
        }
      } catch {
        // 落回原始文本
      }
    }
    return { detail: null, text };
  },

  // Humans
  listHumans: async (): Promise<HumanResponse[]> => {
    const result = await proxyRequest<HumanResponse[] | { humans: HumanResponse[] }>('/humans');
    if (!result || typeof result !== 'object') return [];
    return Array.isArray(result) ? result : (result as { humans: HumanResponse[] }).humans ?? [];
  },

  getHuman: (name: string) => proxyRequest<HumanResponse>(`/humans/${encodeURIComponent(name)}`),

  createHuman: (data: CreateHumanRequest) =>
    proxyRequest<HumanResponse>('/humans', { method: 'POST', body: JSON.stringify(data) }),

  deleteHuman: (name: string) =>
    proxyRequest<void>(`/humans/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  updateHuman: (name: string, data: UpdateHumanRequest) =>
    proxyRequest<HumanResponse>(`/humans/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) }),

  // 配置面（详情抽屉四卡）：回读原始人 CR、配额、共享表清单、PATCH 兜底。
  getHumanConfig: (name: string) =>
    proxyRequest<HumanConfigRecord>(`/humans/${encodeURIComponent(name)}`),

  getHumanQuota: async (name: string): Promise<HumanQuotaResponse> => {
    const raw = await proxyRequest<Partial<HumanQuotaResponse> | null>(
      `/humans/${encodeURIComponent(name)}/quota`,
    );
    return {
      usedBytes: typeof raw?.usedBytes === 'number' ? raw.usedBytes : 0,
      quotaBytes: typeof raw?.quotaBytes === 'number' ? raw.quotaBytes : null,
      quotaFiles: typeof raw?.quotaFiles === 'number' ? raw.quotaFiles : null,
    };
  },

  setHumanQuota: (name: string, data: SetHumanQuotaRequest) =>
    proxyRequest<void>(`/humans/${encodeURIComponent(name)}/quota`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  patchHuman: (name: string, data: Record<string, unknown>) =>
    proxyRequest<HumanResponse>(`/humans/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  listModelAccessTables,
  saveHumanModelAccess,
  saveHumanWorkspaceAccess,

  // Human file sync (read-only; #1499)
  getHumanSyncStatus: (name: string) =>
    proxyRequest<HumanSyncStatus>(`/humans/${encodeURIComponent(name)}/sync/status`),

  getHumanSyncManifest: (name: string) => fetchHumanSyncManifest(name),

  // Managers
  listManagers: async (): Promise<ManagerResponse[]> => {
    const result = await proxyRequest<ManagerResponse[] | { managers: ManagerResponse[] }>('/managers');
    if (!result || typeof result !== 'object') return [];
    return Array.isArray(result) ? result : (result as { managers: ManagerResponse[] }).managers ?? [];
  },

  getManager: (name: string) => proxyRequest<ManagerResponse>(`/managers/${encodeURIComponent(name)}`),

  createManager: (data: CreateManagerRequest) =>
    proxyRequest<ManagerResponse>('/managers', { method: 'POST', body: JSON.stringify(data) }),

  updateManager: (name: string, data: UpdateManagerRequest) =>
    proxyRequest<ManagerResponse>(`/managers/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) }),

  /** 只改模型（PUT /managers/{name} 合并语义——Controller 仅在 model 非空时
   * 写 spec）。多 provider 部署下同时下发 provider；空 provider 永不下发，
   * 否则会把 Controller 现值清空。 */
  updateManagerModel: (name: string, model: string, modelProvider?: string) => {
    const body: Record<string, unknown> = { model };
    if (modelProvider) body.modelProvider = modelProvider;
    return proxyRequest<ManagerResponse>(`/managers/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  /** 重启 Manager（Controller POST /managers/{name}/restart，#1473）。 */
  restartManager: (name: string) =>
    proxyRequest<{ success?: boolean; note?: string }>(
      `/managers/${encodeURIComponent(name)}/restart`,
      { method: 'POST' },
    ),

  /** Manager 容器日志（Dashboard 代理 Controller Docker API；默认尾 300 行）。 */
  getManagerLogs: (name: string, tail: number = MANAGER_LOG_TAIL) =>
    proxyRequest<LogLine[]>(`/managers/${encodeURIComponent(name)}/logs?tail=${clampLogTail(tail)}`),

  deleteManager: (name: string) =>
    proxyRequest<void>(`/managers/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  // Module updates (upstream #1526)
  //
  // Read surface: the Millforge release index plus each plane's installed
  // plugin registry. Write surface: the controller's existing
  // install/update endpoints (the dashboard only forwards them).
  getMillforgeIndex: (query: MillforgeIndexQuery = {}) => {
    const params = new URLSearchParams();
    params.set('source', query.source ?? 'github');
    if (query.repo) params.set('repo', query.repo);
    if (query.ref) params.set('ref', query.ref);
    if (query.channel) params.set('channel', query.channel);
    return proxyRequest<MillforgeIndex>(`/millforge/index?${params.toString()}`);
  },

  // 千锻编译/注入域（工作台插件同一后端）；旧 Controller 404/405 由面板降级。
  getMillforgeSource: () => proxyRequest<MillforgeSource>('/millforge/source'),

  putMillforgeSource: (patch: MillforgeSourcePatch) =>
    proxyRequest<MillforgeSource>('/millforge/source', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  /** 整包覆盖导入（git clone 90s 后端上限 → 前端 300s 宽限）。 */
  importMillforgePack: (ref = 'main') =>
    proxyRequest<MillforgeImportResult>('/millforge/import', {
      method: 'POST',
      body: JSON.stringify({ ref }),
    }),

  getMillforgePacks: () => proxyRequest<MillforgePacksResponse>('/millforge/packs'),

  getMillforgePackFile: (pack: string, path: string) =>
    proxyRequest<MillforgePackFile>(
      `/millforge/packs/${encodeURIComponent(pack)}/file?path=${encodeURIComponent(path)}`,
    ),

  /** 编译预览（编译器 120s 后端上限 → 前端 180s 宽限；422 = 编译器非 0 退出）。 */
  compileMillforge: (req: MillforgeCompileRequest) =>
    proxyRequest<MillforgeBuildResult>('/millforge/compile', {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  preflightMillforgeSouls: (buildId: string, mapping: Record<string, string>) =>
    proxyRequest<MillforgePreflightResult>('/millforge/inject/preflight', {
      method: 'POST',
      body: JSON.stringify({ build_id: buildId, mapping }),
    }),

  /** 注入（逐项 Controller 调用 + 读回验证；HTTP 200 + partial 逐项如实）。 */
  injectMillforge: (req: MillforgeInjectRequest) =>
    proxyRequest<MillforgeInjectResult>('/millforge/inject', {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  rollbackMillforgeSoul: (worker: string) =>
    proxyRequest<MillforgeRollbackResult>('/millforge/rollback', {
      method: 'POST',
      body: JSON.stringify({ worker }),
    }),

  promptMillforge: (pack: string, form: MillforgePromptForm) =>
    proxyRequest<MillforgePromptResult>('/millforge/prompt', {
      method: 'POST',
      body: JSON.stringify({ pack, form }),
    }),

  parseMillforgeTeamJson: (pack: string, text: string) =>
    proxyRequest<MillforgeParseResult>('/millforge/parse-team-json', {
      method: 'POST',
      body: JSON.stringify({ pack, text }),
    }),

  getMillforgeInjections: () =>
    proxyRequest<MillforgeInjectionsResponse>('/millforge/injections'),

  getTeamModules: (name: string) =>
    proxyRequest<TeamModulesResponse>(`/teams/${encodeURIComponent(name)}/modules`),

  getWorkerPlugins: async (name: string): Promise<PluginMetadataEntry[]> => {
    const result = await proxyRequest<PluginMetadataEntry[] | { plugins: PluginMetadataEntry[] }>(
      `/workers/${encodeURIComponent(name)}/plugins`,
    );
    if (!result || typeof result !== 'object') return [];
    return Array.isArray(result) ? result : result.plugins ?? [];
  },

  getManagerPlugins: async (name: string): Promise<PluginMetadataEntry[]> => {
    const result = await proxyRequest<PluginMetadataEntry[] | { plugins: PluginMetadataEntry[] }>(
      `/managers/${encodeURIComponent(name)}/plugins`,
    );
    if (!result || typeof result !== 'object') return [];
    return Array.isArray(result) ? result : result.plugins ?? [];
  },

  installTeamModule: (team: string, module: string, data: ModuleInstallRequest) =>
    proxyRequest<ModuleInstallResult>(
      `/teams/${encodeURIComponent(team)}/modules/${encodeURIComponent(module)}/install`,
      { method: 'POST', body: JSON.stringify(data) },
    ),

  installWorkerPlugin: (worker: string, data: ModuleInstallRequest) =>
    proxyRequest<ModuleInstallResult>(`/workers/${encodeURIComponent(worker)}/plugins/install`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  installManagerPlugin: (manager: string, data: ModuleInstallRequest) =>
    proxyRequest<ModuleInstallResult>(`/managers/${encodeURIComponent(manager)}/plugins/install`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Gateway
  listConsumers: async (): Promise<ConsumerResponse[]> => {
    const result = await proxyRequest<ConsumerResponse[] | { consumers: ConsumerResponse[] }>('/gateway/consumers');
    if (!result || typeof result !== 'object') return [];
    return Array.isArray(result) ? result : (result as { consumers: ConsumerResponse[] }).consumers ?? [];
  },

  createConsumer: (data: CreateConsumerRequest) =>
    proxyRequest<ConsumerResponse>('/gateway/consumers', { method: 'POST', body: JSON.stringify(data) }),

  bindConsumer: (id: string) =>
    proxyRequest<void>(`/gateway/consumers/${encodeURIComponent(id)}/bind`, { method: 'POST' }),

  deleteConsumer: (id: string) =>
    proxyRequest<void>(`/gateway/consumers/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Packages
  uploadPackage: async (file: File): Promise<WorkerSkillUploadResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(apiUrl('/api/agentteams/packages'), {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(`Upload failed ${res.status}: ${text}`, res.status, '/packages');
    }
    return res.json() as Promise<WorkerSkillUploadResponse>;
  },

  // Infrastructure
  getInfrastructure: () => proxyRequest<InfrastructureInfo>('/infrastructure'),

  // Storage
  listBuckets: async (): Promise<BucketResponse[]> => {
    const result = await proxyRequest<BucketResponse[] | { buckets: BucketResponse[] }>('/storage/buckets');
    if (!result || typeof result !== 'object') return [];
    return Array.isArray(result) ? result : (result as { buckets: BucketResponse[] }).buckets ?? [];
  },

  listObjects: async (bucket: string, prefix?: string) => {
    const query = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
    const result = await proxyRequest<StorageObject[] | { objects: StorageObject[] }>(
      `/storage/buckets/${encodeURIComponent(bucket)}/objects${query}`,
      { method: 'GET' }
    );
    if (!result || typeof result !== 'object') return [];
    return Array.isArray(result) ? result : (result as { objects: StorageObject[] }).objects ?? [];
  },

  listWorkerFiles: async (workerName: string, prefix?: string): Promise<StorageObject[]> => {
    const query = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
    const result = await proxyRequest<StorageObject[] | { objects: StorageObject[] }>(
      `/workers/${encodeURIComponent(workerName)}/files${query}`,
      { method: 'GET' }
    );
    if (!result || typeof result !== 'object') return [];
    return Array.isArray(result) ? result : result.objects ?? [];
  },

  // Team shared workspace: the AgentTeams team-scoped layout under
  // `teams/{team}/shared/` (tasks/projects produced by TeamHarness MCP).
  listTeamFiles: async (teamName: string, prefix?: string): Promise<StorageObject[]> => {
    const query = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
    const result = await proxyRequest<StorageObject[] | { objects: StorageObject[] }>(
      `/teams/${encodeURIComponent(teamName)}/files${query}`,
      { method: 'GET' }
    );
    if (!result || typeof result !== 'object') return [];
    return Array.isArray(result) ? result : result.objects ?? [];
  },

  uploadTeamFile: async (teamName: string, file: File, prefix?: string): Promise<{ key: string; size: number }> => {
    const form = new FormData();
    form.append('file', file);
    const query = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
    const res = await fetch(
      apiUrl(`/api/agentteams/teams/${encodeURIComponent(teamName)}/files/upload${query}`),
      { method: 'POST', body: form },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(`文件上传失败: ${res.status} ${text}`, res.status, `/teams/${teamName}/files/upload`);
    }
    return res.json();
  },

  uploadWorkerFile: async (workerName: string, file: File, prefix?: string): Promise<{ key: string; size: number }> => {
    const form = new FormData();
    form.append('file', file);
    const query = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
    const res = await fetch(
      apiUrl(`/api/agentteams/workers/${encodeURIComponent(workerName)}/files/upload${query}`),
      { method: 'POST', body: form },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(`文件上传失败: ${res.status} ${text}`, res.status, `/workers/${workerName}/files/upload`);
    }
    return res.json();
  },

  deleteObject: (bucket: string, key: string) =>
    proxyRequest<void>(`/storage/buckets/${encodeURIComponent(bucket)}/objects/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    }),

  createBucket: (name: string) =>
    proxyRequest<BucketResponse>('/storage/buckets', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  deleteBucket: (name: string) =>
    proxyRequest<void>(`/storage/buckets/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),

  getBucketStats: (bucket: string) =>
    proxyRequest<{ bucket: string; objectCount: number; totalSize: number }>(
      `/storage/buckets/${encodeURIComponent(bucket)}/stats`,
      { method: 'GET' }
    ),

  bulkDeleteObjects: (bucket: string, keys: string[]) =>
    proxyRequest<{ deleted: string[]; errors?: string[] }>(
      `/storage/buckets/${encodeURIComponent(bucket)}/bulk-delete`,
      { method: 'POST', body: JSON.stringify({ keys }) }
    ),

  presignUpload: (bucket: string, key: string, contentType?: string) =>
    proxyRequest<PresignUploadResponse>('/storage/presign', {
      method: 'POST',
      body: JSON.stringify({ bucket, key, contentType }),
    }),

  presignDownload: (bucket: string, key: string) =>
    proxyRequest<PresignDownloadResponse>(
      `/storage/presign?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`,
      { method: 'GET' }
    ),

  downloadObjectUrl: (bucket: string, key: string): string => {
    return apiUrl(`/api/agentteams/storage/download?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`);
  },

  downloadWorkerFileUrl: (workerName: string, key: string): string => {
    return apiUrl(`/api/agentteams/workers/${encodeURIComponent(workerName)}/files/download?key=${encodeURIComponent(key)}`);
  },

  downloadTeamFileUrl: (teamName: string, key: string): string => {
    return apiUrl(`/api/agentteams/teams/${encodeURIComponent(teamName)}/files/download?key=${encodeURIComponent(key)}`);
  },

  uploadObject: async (bucket: string, key: string, file: File): Promise<void> => {
    const url = apiUrl(`/api/agentteams/storage/upload?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}&contentType=${encodeURIComponent(file.type || 'application/octet-stream')}`);
    const res = await fetch(url, {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(`Upload failed: ${res.status} ${text}`, res.status, url);
    }
  },

  // Worker skills distribution
  listWorkerSkills: (workerName: string, runtime?: string | null) => {
    const qs = runtime ? `?runtime=${encodeURIComponent(runtime)}` : '';
    return proxyRequest<WorkerSkillsListResponse>(
      `/workers/${encodeURIComponent(workerName)}/skills${qs}`,
    );
  },

  uploadWorkerSkill: (
    workerName: string,
    file: File,
    runtime?: string | null,
    options?: { restart?: boolean },
  ): Promise<WorkerSkillUploadResponse> => {
    const form = new FormData();
    form.append('file', file);
    if (runtime) form.append('runtime', runtime);
    const restart = options?.restart ?? true;
    const url = apiUrl(`/api/agentteams/workers/${encodeURIComponent(workerName)}/skills?restart=${restart}`);
    return fetch(url, {
      method: 'POST',
      body: form,
    }).then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ApiError(`上传技能包失败: ${res.status} ${text}`, res.status, `/workers/${workerName}/skills`);
      }
      return res.json() as Promise<WorkerSkillUploadResponse>;
    });
  },

  restartWorker: (workerName: string): Promise<{ success: boolean; note: string; skills?: string[] }> => {
    return fetch(apiUrl(`/api/agentteams/workers/${encodeURIComponent(workerName)}/restart`), {
      method: 'POST',
    }).then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ApiError(`Worker 重启失败: ${res.status} ${text}`, res.status, `/workers/${workerName}/restart`);
      }
      return res.json();
    });
  },

  // Logs
  getLogs: (component: string, options?: { tail?: number; since?: string; level?: string }) => {
    const params = new URLSearchParams();
    if (options?.tail) params.set('tail', String(options.tail));
    if (options?.since) params.set('since', options.since);
    if (options?.level) params.set('level', options.level);
    const query = params.toString() ? `?${params.toString()}` : '';
    return proxyRequest<LogLine[]>(`/logs/${encodeURIComponent(component)}${query}`, { method: 'GET' });
  },

  // Setup
  ensureAiGateway: (): Promise<{ success: boolean; message?: string }> =>
    proxyRequest<{ success: boolean; message?: string }>('/setup/ensure-ai', { method: 'POST' }),

  // MCP Servers
  listMcpServers: (): Promise<McpServerListResponse> =>
    proxyRequest<McpServerListResponse>('/mcps'),

  getMcpServer: (name: string): Promise<McpServerConfig> =>
    proxyRequest<McpServerConfig>(`/mcps/${encodeURIComponent(name)}`),

  createMcpServer: (data: { name: string; url: string; transport: string; description?: string }): Promise<McpServerConfig & { success: boolean }> => {
    const res = fetch(apiUrl('/api/agentteams/mcps'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.then(async (r) => {
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new ApiError(`创建 MCP 服务器失败: ${r.status} ${text}`, r.status, '/mcps');
      }
      return r.json() as Promise<McpServerConfig & { success: boolean }>;
    });
  },

  updateMcpServer: (name: string, data: { url?: string; transport?: string; description?: string }): Promise<McpServerConfig & { success: boolean }> => {
    const res = fetch(apiUrl(`/api/agentteams/mcps/${encodeURIComponent(name)}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.then(async (r) => {
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new ApiError(`更新 MCP 服务器失败: ${r.status} ${text}`, r.status, `/mcps/${name}`);
      }
      return r.json() as Promise<McpServerConfig & { success: boolean }>;
    });
  },

  deleteMcpServer: (name: string): Promise<void> => {
    const res = fetch(apiUrl(`/api/agentteams/mcps/${encodeURIComponent(name)}`), {
      method: 'DELETE',
    });
    return res.then(async (r) => {
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new ApiError(`删除 MCP 服务器失败: ${r.status} ${text}`, r.status, `/mcps/${name}`);
      }
      await r.json();
      return undefined;
    });
  },

  testMcpServer: (data: { url: string; transport: string; headers?: Record<string, string>; timeout?: number }): Promise<McpTestResult> => {
    const res = fetch(apiUrl('/api/agentteams/mcps/test'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.then(async (r) => {
      const json = await r.json() as McpTestResult;
      if (!r.ok) throw new ApiError(json.message || '连通性测试失败', r.status, '/mcps/test');
      return json;
    });
  },

  // Skill Center
  listSkills: (queryParams?: string): Promise<{ skills: SkillEntry[]; total: number }> => {
    const query = queryParams ? `?${queryParams}` : '';
    return proxyRequest<{ skills: SkillEntry[]; total: number }>(`/skills${query}`);
  },

  getSkill: (name: string): Promise<SkillEntry> =>
    proxyRequest<SkillEntry>(`/skills/${encodeURIComponent(name)}`),

  downloadSkill: (name: string): Promise<File> => {
    const url = apiUrl(`/api/agentteams/skills/${encodeURIComponent(name)}/download`);
    return fetch(url).then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ApiError(`下载技能失败: ${res.status} ${text}`, res.status, `/skills/${name}/download`);
      }
      const blob = await res.blob();
      return new File([blob], `${name}.zip`, { type: 'application/zip' });
    });
  },

  downloadNacosSkill: (name: string): Promise<File> => {
    const url = apiUrl(`/api/agentteams/skills/nacos/${encodeURIComponent(name)}/download`);
    return fetch(url).then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ApiError(`下载 Nacos 技能失败: ${res.status} ${text}`, res.status, `/skills/nacos/${name}/download`);
      }
      const blob = await res.blob();
      return new File([blob], `${name}.zip`, { type: 'application/zip' });
    });
  },

  createSkill: (file: File, overwrite = false): Promise<SkillEntry & { success: boolean; conflict?: boolean }> => {
    const form = new FormData();
    form.append('file', file);
    if (overwrite) {
      form.append('overwrite', 'true');
    }
    const res = fetch(apiUrl('/api/agentteams/skills'), {
      method: 'POST',
      body: form,
    });
    return res.then(async (r) => {
      const json = await r.json() as Record<string, unknown>;
      if (!r.ok) {
        if (r.status === 409 && json.conflict) {
          return {
            success: false,
            conflict: true,
            name: (json.existing as SkillEntry)?.name ?? '',
            description: (json.existing as SkillEntry)?.description ?? '',
            source: (json.existing as SkillEntry)?.source ?? 'custom',
            sourceAlias: (json.existing as SkillEntry)?.sourceAlias,
            version: (json.existing as SkillEntry)?.version,
            createdAt: (json.existing as SkillEntry)?.createdAt ?? '',
            updatedAt: (json.existing as SkillEntry)?.updatedAt ?? '',
            fileCount: (json.existing as SkillEntry)?.fileCount ?? 0,
          } as SkillEntry & { success: boolean; conflict: boolean };
        }
        const text = await r.text().catch(() => '');
        throw new ApiError(`上传技能失败: ${r.status} ${text}`, r.status, '/skills');
      }
      return json as unknown as SkillEntry & { success: boolean };
    });
  },

  updateSkill: (name: string, data: { description?: string; version?: string }): Promise<SkillEntry> => {
    const res = fetch(apiUrl(`/api/agentteams/skills/${encodeURIComponent(name)}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.then(async (r) => {
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new ApiError(`更新技能失败: ${r.status} ${text}`, r.status, `/skills/${name}`);
      }
      return r.json() as Promise<SkillEntry>;
    });
  },

  deleteSkill: (name: string): Promise<void> => {
    const res = fetch(apiUrl(`/api/agentteams/skills/${encodeURIComponent(name)}`), {
      method: 'DELETE',
    });
    return res.then(async (r) => {
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new ApiError(`删除技能失败: ${r.status} ${text}`, r.status, `/skills/${name}`);
      }
      await r.json();
      return undefined;
    });
  },

  // Nacos Config
  getNacosConfig: (): Promise<NacosConfig | null> =>
    proxyRequest<{ config: NacosConfig | null }>('/skills/nacos/config').then((r) => r.config),

  updateNacosConfig: (config: NacosConfig): Promise<NacosConfig> => {
    const res = fetch(apiUrl('/api/agentteams/skills/nacos/config'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return res.then(async (r) => {
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new ApiError(`更新 Nacos 配置失败: ${r.status} ${text}`, r.status, '/skills/nacos/config');
      }
      return r.json() as Promise<NacosConfig>;
    });
  },

  syncNacosSkills: (): Promise<{ synced: number }> => {
    const res = fetch(apiUrl('/api/agentteams/skills/nacos/sync'), {
      method: 'POST',
    });
    return res.then(async (r) => {
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new ApiError(`Nacos 同步失败: ${r.status} ${text}`, r.status, '/skills/nacos/sync');
      }
      return r.json() as Promise<{ synced: number }>;
    });
  },

  fullSyncNacosSkills: (): Promise<{ success: boolean; downloaded: number; skipped: number; failed: number }> => {
    const res = fetch(apiUrl('/api/agentteams/skills/nacos/full-sync'), {
      method: 'POST',
    });
    return res.then(async (r) => {
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new ApiError(`Nacos 全量同步失败: ${r.status} ${text}`, r.status, '/skills/nacos/full-sync');
      }
      return r.json();
    });
  },

  getNacosSyncStatus: (): Promise<{
    nacosConfigured: boolean;
    lastSyncAt: string | null;
    lastSyncStatus: string | null;
    versionCacheSize: number;
    versionCache: Record<string, string>;
  }> => {
    return proxyRequest('/skills/nacos/status');
  },

  // AgentSpecs
  listAgentSpecs: (): Promise<{ items: Array<{ name: string; description: string; version: string; from: string; scope: string }>; note?: string }> => {
    return proxyRequest('/agentspecs/nacos/list');
  },

  getAgentSpecDetail: (
    name: string,
    version: string,
  ): Promise<{
    name: string;
    image?: string;
    runtime: 'openclaw';
    soul?: string;
    description: string;
    version: string;
    from: string;
  }> => {
    const qs = `?name=${encodeURIComponent(name)}&version=${encodeURIComponent(version)}`;
    return proxyRequest(`/agentspecs/nacos/detail${qs}`);
  },

  // 项目/任务 meta（meta.json）：GET 返回 {raw, etag}；保存 PUT + If-Match。
  // 契约与错误分类在 @/lib/meta-api（405/404 = 端点不可用 → 入口隐藏）。
  getProjectMeta: (id: string): Promise<MetaReadResult> => fetchProjectMeta(id),

  getTaskMeta: (id: string, team?: string): Promise<MetaReadResult> =>
    fetchTaskMeta(id, team),

  saveProjectMeta: (id: string, raw: string, etag: string): Promise<MetaReadResult> =>
    putProjectMeta(id, raw, etag),

  saveTaskMeta: (
    id: string,
    raw: string,
    etag: string,
    team?: string,
  ): Promise<MetaReadResult> => putTaskMeta(id, raw, etag, team),
};

// ── Worker MCP 合并读（CRD 声明 + worker 自注册）─────────────────────────
//
// GET /api/agentteams/workers/{name}/mcp → Controller
// GET /api/v1/workers/{name}/mcp（worker 的 QwenPaw `mcp.clients` 注册表）。
// Next 代理已在服务端把 200 响应归一化/脱敏（env/headers 只剩键名），
// 本函数只负责状态码语义：端点缺失/无凭据/无权限/部署形态不支持都降级为
// `available:false`，调用方据此显示一行提示而不是宣称「没有 MCP」。
export async function fetchWorkerMcp(name: string): Promise<WorkerMcpResult> {
  const path = `/workers/${encodeURIComponent(name)}/mcp`;
  let res: Response;
  try {
    res = await fetch(apiUrl(`/api/agentteams${path}`), { cache: 'no-store' });
  } catch (err) {
    throw new NetworkError(path, err);
  }

  const degrade = (reason: string): WorkerMcpResult => ({ available: false, reason, items: [] });
  if (res.status === 404) return degrade('controller_too_old');
  if (res.status === 401) return degrade('no_token');
  if (res.status === 403) return degrade('forbidden');
  if (res.status === 400 || res.status === 503) return degrade('unsupported');
  if (!res.ok) {
    const detail = await extractErrorDetail(res, `HTTP ${res.status}`);
    throw new ApiError(detail, res.status, path);
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new ApiError('worker 自注册 MCP 响应不是合法 JSON', res.status, path);
  }

  // 防御性：代理若已按插件契约返回 available=false 信封，直接透传降级原因。
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    const envelope = payload as { available?: unknown; reason?: unknown; items?: unknown };
    if (envelope.available === false) {
      return {
        available: false,
        reason: typeof envelope.reason === 'string' ? envelope.reason : 'unknown',
        items: normalizeWorkerMcpItems(envelope.items),
      };
    }
  }
  return { available: true, items: normalizeWorkerMcpItems(payload) };
}
