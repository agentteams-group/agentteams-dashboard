// Higress Console API Client — AI Provider & Route Management
// All requests go through Next.js API proxy routes to Higress Console

import { apiUrl } from '@/lib/api-base';

// ============ Types ============

export interface LlmProvider {
  name: string;
  type: string;           // openai, claude, qwen, deepseek, gemini, ollama, ...
  protocol?: string;      // 'openai/v1' | 'original'
  tokens: string[];       // API keys (multiple for rotation)
  tokenFailoverConfig?: {
    enabled: boolean;
    failureThreshold: number;
    successThreshold: number;
    healthCheckInterval: number;
    healthCheckModel: string;
  };
  rawConfigs?: Record<string, unknown>;
}

export interface LlmProviderResponse {
  name: string;
  type: string;
  protocol?: string;
  tokenCount: number;     // masked: only show count, not actual keys
  tokenFailoverConfig?: LlmProvider['tokenFailoverConfig'];
  rawConfigs?: Record<string, unknown>;
}

export interface CreateLlmProviderRequest {
  name: string;
  type: string;
  protocol?: string;
  tokens: string[];
  tokenFailoverConfig?: LlmProvider['tokenFailoverConfig'];
  rawConfigs?: Record<string, unknown>;
}

export interface UpdateLlmProviderRequest {
  type?: string;
  protocol?: string;
  tokens?: string[];
  tokenFailoverConfig?: LlmProvider['tokenFailoverConfig'];
  rawConfigs?: Record<string, unknown>;
}

export interface AiRoute {
  name: string;
  domains?: string[];
  pathPredicate: { matchType: string; matchValue: string };
  upstreams: {
    provider: string;
    weight: number;
    modelMapping?: Record<string, string>;
  }[];
  modelPredicates?: { matchType: string; matchValue: string }[];
  authConfig?: { enabled: boolean; allowedCredentialTypes: string[] };
  fallbackConfig?: Record<string, unknown>;
  cors?: Record<string, unknown>;
  headerControl?: Record<string, unknown>;
}

export interface CreateAiRouteRequest {
  name: string;
  domains?: string[];
  pathPredicate: { matchType: string; matchValue: string };
  upstreams: {
    provider: string;
    weight: number;
    modelMapping?: Record<string, string>;
  }[];
  modelPredicates?: { matchType: string; matchValue: string }[];
  authConfig?: { enabled: boolean; allowedCredentialTypes: string[] };
}

// Supported provider types with display labels
export const PROVIDER_TYPES = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'azure', label: 'Azure OpenAI' },
  { value: 'claude', label: 'Anthropic Claude' },
  { value: 'qwen', label: '通义千问 (Qwen)' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'groq', label: 'Groq' },
  { value: 'grok', label: 'Grok (xAI)' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'ollama', label: 'Ollama (本地)' },
  { value: 'vllm', label: 'vLLM' },
  { value: 'moonshot', label: 'Moonshot (月之暗面)' },
  { value: 'baichuan', label: '百川智能' },
  { value: 'yi', label: '零一万物 (Yi)' },
  { value: 'zhipuai', label: '智谱 AI (GLM)' },
  { value: 'baidu', label: '百度文心' },
  { value: 'hunyuan', label: '腾讯混元' },
  { value: 'stepfun', label: '阶跃星辰' },
  { value: 'minimax', label: 'MiniMax' },
  { value: 'spark', label: '讯飞星火' },
  { value: 'mistral', label: 'Mistral AI' },
  { value: 'cohere', label: 'Cohere' },
  { value: 'doubao', label: '字节豆包' },
  { value: 'together-ai', label: 'Together AI' },
  { value: 'github', label: 'GitHub Models' },
  { value: 'bedrock', label: 'AWS Bedrock' },
  { value: 'vertex', label: 'Google Vertex AI' },
  { value: 'cloudflare', label: 'Cloudflare Workers AI' },
  { value: 'coze', label: 'Coze' },
] as const;

// Provider types that need a custom base URL
export const PROVIDERS_NEED_BASE_URL = new Set([
  'openai', 'ollama', 'vllm', 'openrouter',
]);

// ============ Client ============

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || `Higress API error: ${res.status}`);
  }
  return res.json();
}

export const higressApi = {
  // ---- AI Providers ----
  listProviders: (): Promise<LlmProviderResponse[]> =>
    request<{ providers: LlmProviderResponse[] }>('/api/higress/ai-providers')
      .then((r) => r.providers ?? []),

  getProvider: (name: string): Promise<LlmProviderResponse> =>
    request<LlmProviderResponse>(`/api/higress/ai-providers/${encodeURIComponent(name)}`),

  createProvider: (data: CreateLlmProviderRequest): Promise<LlmProviderResponse> =>
    request<LlmProviderResponse>('/api/higress/ai-providers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateProvider: (name: string, data: UpdateLlmProviderRequest): Promise<LlmProviderResponse> =>
    request<LlmProviderResponse>(`/api/higress/ai-providers/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteProvider: (name: string): Promise<void> =>
    request<{ success: boolean }>(`/api/higress/ai-providers/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }).then(() => undefined),

  // ---- AI Routes ----
  listRoutes: (): Promise<AiRoute[]> =>
    request<{ routes: AiRoute[] }>('/api/higress/ai-routes')
      .then((r) => r.routes ?? []),

  getRoute: (name: string): Promise<AiRoute> =>
    request<AiRoute>(`/api/higress/ai-routes/${encodeURIComponent(name)}`),

  createRoute: (data: CreateAiRouteRequest): Promise<AiRoute> =>
    request<AiRoute>('/api/higress/ai-routes', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateRoute: (name: string, data: Partial<CreateAiRouteRequest>): Promise<AiRoute> =>
    request<AiRoute>(`/api/higress/ai-routes/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteRoute: (name: string): Promise<void> =>
    request<{ success: boolean }>(`/api/higress/ai-routes/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }).then(() => undefined),
};
