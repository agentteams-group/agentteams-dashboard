// HiClaw API Client - Complete TypeScript API layer
// All requests go through Next.js API proxy routes

import { ApiError, NetworkError } from '@/lib/api-error';
import { apiUrl } from '@/lib/api-base';

// ============ Response Types ============

export type WorkerPhase = 'Pending' | 'Running' | 'Sleeping' | 'Updating' | 'Stopped' | 'Failed' | 'Ready';
export type WorkerState = 'Running' | 'Sleeping' | 'Stopped';
export type WorkerRuntime = 'openclaw' | 'copaw' | 'hermes' | 'openhuman';
export type TeamPhase = 'Pending' | 'Active' | 'Degraded' | 'Failed';
export type HumanPhase = 'Pending' | 'Active' | 'Failed';
export type ManagerPhase = 'Running' | 'Pending' | 'Failed';
export type ManagerState = 'Running' | 'Sleeping' | 'Stopped';

export interface ExposedPort {
  port: number;
  domain: string;
}

export interface WorkerResponse {
  name: string;
  phase: WorkerPhase;
  state: WorkerState;
  containerManaged: boolean;
  model: string;
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
  model: string;
  runtime: string;
  image: string;
  matrixUserID: string;
  roomID: string;
  version: string;
  message: string;
  welcomeSent: boolean;
  skills?: string[];
}

export interface CreateWorkerRequest {
  name: string;
  model?: string;
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
  model?: string;
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
  model?: string;
  runtime?: string;
  image?: string;
}

export interface UpdateManagerRequest {
  model?: string;
  runtime?: string;
  image?: string;
}

export interface CreateConsumerRequest {
  name: string;
  password: string;
}

export interface ConsumerResponse {
  name: string;
  consumer_id?: string;
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

export interface InfrastructureInfo {
  minio?: { healthy: boolean; endpoint: string; buckets: string[] };
  higress?: { healthy: boolean; endpoint: string };
  matrix?: { healthy: boolean; homeserver: string };
  kubernetes?: { healthy: boolean; version: string };
  controller?: { healthy: boolean; version: string };
}

export interface ModelResponse {
  name: string;
  provider: string;
  baseUrl?: string;
  apiKeyMasked?: string;
  capabilities?: string[];
  default?: boolean;
}

export interface CreateModelRequest {
  name: string;
  provider: string;
  apiKey: string;
  baseUrl?: string;
  capabilities?: string[];
  default?: boolean;
}

export interface UpdateModelRequest {
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  capabilities?: string[];
  default?: boolean;
}

// ============ Proxy Request Helper ============

async function proxyRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(`/api/hiclaw${path}`), {
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
    ? `/api/hiclaw/healthz/?controllerUrl=${encodeURIComponent(controllerUrl)}`
    : '/api/hiclaw/healthz/';
  const res = await fetch(path, { method: 'GET' });
  if (!res.ok) throw new ApiError(`Health check failed: ${res.status}`, res.status, '/healthz');
  return res.text();
}

// ============ API Methods ============

export const hiclawApi = {
  // Health & Status
  checkHealth: (controllerUrl: string) => healthRequest(controllerUrl),

  getStatus: () => proxyRequest<ClusterStatus>('/cluster-status'),

  getVersion: () => proxyRequest<VersionInfo>('/version'),

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

  createTeam: (data: CreateTeamRequest) => {
    // 兼容旧字段 admin：Controller 实际接收的是 leader.name
    const payload: CreateTeamRequest & { leader?: { name: string } } = { ...data };
    if (payload.admin && !payload.leader) {
      payload.leader = payload.admin;
      delete payload.admin;
    }
    return proxyRequest<TeamResponse>('/teams', { method: 'POST', body: JSON.stringify(payload) });
  },

  updateTeam: (name: string, data: UpdateTeamRequest) =>
    proxyRequest<TeamResponse>(`/teams/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) }),

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
  uploadPackage: async (file: File): Promise<{ packageUri: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(apiUrl('/api/hiclaw/packages'), {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(`Upload failed ${res.status}: ${text}`, res.status, '/upload');
    }
    return res.json();
  },

  // Infrastructure
  getInfrastructure: () => proxyRequest<InfrastructureInfo>('/infrastructure'),

  // Models
  listModels: async (): Promise<ModelResponse[]> => {
    const result = await proxyRequest<ModelResponse[] | { models: ModelResponse[] }>('/models');
    if (!result || typeof result !== 'object') return [];
    return Array.isArray(result) ? result : (result as { models: ModelResponse[] }).models ?? [];
  },

  getModel: (name: string) => proxyRequest<ModelResponse>(`/models/${encodeURIComponent(name)}`),

  createModel: (data: CreateModelRequest) =>
    proxyRequest<ModelResponse>('/models', { method: 'POST', body: JSON.stringify(data) }),

  updateModel: (name: string, data: UpdateModelRequest) =>
    proxyRequest<ModelResponse>(`/models/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(data) }),

  deleteModel: (name: string) =>
    proxyRequest<void>(`/models/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  getDefaultModel: () => proxyRequest<ModelResponse | null>('/models/default'),

  setDefaultModel: (name: string) =>
    proxyRequest<void>('/models/default', { method: 'POST', body: JSON.stringify({ name }) }),
};
