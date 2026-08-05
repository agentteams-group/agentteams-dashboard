// AgentTeams API Client - Complete TypeScript API layer
// All requests go through Next.js API proxy routes

import { ApiError, NetworkError } from '@/lib/api-error';
import { apiUrl } from '@/lib/api-base';
import type { SkillEntry, NacosConfig } from '@/lib/skill-center-types';

// ============ Response Types ============

export type WorkerPhase = 'Pending' | 'Running' | 'Sleeping' | 'Updating' | 'Stopped' | 'Failed' | 'Ready';
export type WorkerState = 'Running' | 'Sleeping' | 'Stopped';
export type WorkerRuntime = 'openclaw' | 'copaw' | 'hermes' | 'openhuman' | 'qwenpaw';
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

export interface WorkerResponse {
  name: string;
  phase: WorkerPhase;
  state: WorkerState;
  containerManaged: boolean;
  model: RequestModelAlias;
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
}

export interface TeamResponse {
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
  workerNames: string[];
  workerExposedPorts: Record<string, ExposedPort[]>;
}

export interface HumanResponse {
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

export interface ManagerResponse {
  name: string;
  phase: ManagerPhase;
  state: ManagerState;
  model: RequestModelAlias;
  runtime: string;
  image: string;
  matrixUserID: string;
  roomID: string;
  leaderDMRoomID?: string;
  version: string;
  message: string;
  welcomeSent: boolean;
  skills?: string[];
}

export interface CreateWorkerRequest {
  name: string;
  model?: RequestModelAlias;
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

export interface UpdateWorkerRequest {
  model?: RequestModelAlias;
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

export interface CreateTeamRequest {
  name: string;
  teamName?: string;
  description?: string;
  leader?: { name: string };
  admin?: { name: string };
  workerNames?: string[];
  humanMembers?: string[];
}

export interface UpdateTeamRequest {
  teamName?: string;
  description?: string;
  leader?: { name: string } | null;
  admin?: { name: string } | null;
  workerNames?: string[];
  humanMembers?: string[];
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
 * create the missing ones with the minimal Worker payload (name + runtime).
 */
async function ensureWorkersExist(members: TeamWorkerMember[]): Promise<void> {
  const existing = await agentteamsApi.listWorkers();
  const existingNames = new Set(existing.map((worker) => worker.name));
  const missing = [...new Set(members.map((member) => member.name))]
    .filter((name) => name && !existingNames.has(name));
  for (const name of missing) {
    await proxyRequest<WorkerResponse>('/workers', {
      method: 'POST',
      body: JSON.stringify({ name, runtime: 'openclaw' as WorkerRuntime }),
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
  runtime?: string;
  image?: string;
}

export interface UpdateManagerRequest {
  model?: RequestModelAlias;
  runtime?: string;
  image?: string;
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

export interface TroubleshootRequest {
  component: string;
  symptom: string;
  logs?: string;
  infraSnapshot?: InfrastructureInfo;
}

export type TroubleshootResponse = ReadableStream<Uint8Array>;

// ============ Proxy Request Helper ============

async function proxyRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(`/api/agentteams${path}`), {
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
    });
  } catch (err) {
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
    return await res.json();
  } catch (err) {
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

  createTeam: async (data: CreateTeamRequest) => {
    // 兼容旧字段 admin：Controller 实际接收的是 leader.name（workerMembers 中的 team_leader）
    const { workerNames, leader, ...rest } = data;
    const payload: Record<string, unknown> = { ...rest };
    if (payload.admin && !leader) {
      payload.leader = payload.admin;
    }
    const workerMembers = buildWorkerMembers(leader, workerNames);
    await ensureWorkersExist(workerMembers);
    payload.workerMembers = workerMembers;
    delete payload.leader;
    delete payload.workerNames;
    return proxyRequest<TeamResponse>('/teams', { method: 'POST', body: JSON.stringify(payload) });
  },

  updateTeam: async (name: string, data: UpdateTeamRequest) => {
    const { workerNames, leader, admin, ...rest } = data;
    const payload: Record<string, unknown> = { ...rest };
    if (admin !== undefined) payload.admin = admin;
    if (workerNames !== undefined) {
      const workerMembers = buildWorkerMembers(leader ?? undefined, workerNames);
      await ensureWorkersExist(workerMembers);
      payload.workerMembers = workerMembers;
    }
    delete payload.leader;
    delete payload.workerNames;
    return proxyRequest<TeamResponse>(`/teams/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(payload) });
  },

  deleteTeam: (name: string) =>
    proxyRequest<void>(`/teams/${encodeURIComponent(name)}`, { method: 'DELETE' }),

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

  deleteManager: (name: string) =>
    proxyRequest<void>(`/managers/${encodeURIComponent(name)}`, { method: 'DELETE' }),

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
  listWorkerSkills: (workerName: string) =>
    proxyRequest<WorkerSkillsListResponse>(`/workers/${encodeURIComponent(workerName)}/skills`),

  uploadWorkerSkill: (workerName: string, file: File): Promise<WorkerSkillUploadResponse> => {
    const form = new FormData();
    form.append('file', file);
    return fetch(apiUrl(`/api/agentteams/workers/${encodeURIComponent(workerName)}/skills`), {
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

  // Logs
  getLogs: (component: string, options?: { tail?: number; since?: string; level?: string }) => {
    const params = new URLSearchParams();
    if (options?.tail) params.set('tail', String(options.tail));
    if (options?.since) params.set('since', options.since);
    if (options?.level) params.set('level', options.level);
    const query = params.toString() ? `?${params.toString()}` : '';
    return proxyRequest<LogLine[]>(`/logs/${encodeURIComponent(component)}${query}`, { method: 'GET' });
  },

  // AI Troubleshooting
  troubleshoot: async (body: TroubleshootRequest): Promise<Response> => {
    const res = await fetch(apiUrl('/api/agentteams/troubleshoot'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(`Troubleshoot failed: ${text || res.statusText}`, res.status, '/troubleshoot');
    }
    return res;
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

  testMcpServer: (data: { url: string; transport: string; timeout?: number }): Promise<McpTestResult> => {
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
};
