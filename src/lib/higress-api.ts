// Higress Console API Client — AI Provider & Route Management
// All requests go through Next.js API proxy routes to Higress Console

import { apiUrl } from '@/lib/api-base';

export const HIGRESS_CONSOLE_API_VERSION = 'v1';

export interface FallbackConfig {
  enabled?: boolean;
  maxRetries?: number;
  retryOn?: string[];
  retryStatusCodes?: number[];
  fallbacks?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

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

export interface AiRouteAuthConfig {
  enabled: boolean;
  allowedCredentialTypes: string[];
  // AgentTeams Controller owns this list and the Dashboard preserves it on edits.
  allowedConsumers?: string[];
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
  authConfig?: AiRouteAuthConfig;
  fallbackConfig?: Record<string, unknown>;
  fallbackConfigWritable?: boolean;
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
  authConfig?: AiRouteAuthConfig;
  fallbackConfig?: Record<string, unknown>;
}

export interface ModelMappingRule {
  pattern: string;
  targetModel: string;
}

export interface ProviderForm {
  name: string;
  type: string;
  protocol: 'openai/v1' | 'original';
  tokens: string[];
  baseUrl?: string;
  tokenFailoverConfig?: LlmProvider['tokenFailoverConfig'];
  modelMappings: ModelMappingRule[];
}

export interface RouteUpstreamForm {
  provider: string;
  weight: number;
  modelMappings: ModelMappingRule[];
}

export interface RouteForm {
  name: string;
  pathPredicate: AiRoute['pathPredicate'];
  upstreams: RouteUpstreamForm[];
  modelPredicates: NonNullable<AiRoute['modelPredicates']>;
  authConfig: AiRouteAuthConfig;
  fallbackConfig?: Record<string, unknown>;
}

export function parseFallbackConfig(value: string): { config?: FallbackConfig; error?: string } {
  if (!value.trim()) return { config: {} };
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      return { error: '回退配置必须是 JSON 对象' };
    }
    const config = parsed as FallbackConfig;
    const errors = validateFallbackConfig(config);
    return errors.length > 0 ? { error: errors[0] } : { config };
  } catch {
    return { error: '回退配置必须是有效 JSON' };
  }
}

export function validateFallbackConfig(config: FallbackConfig): string[] {
  const errors: string[] = [];
  if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
    errors.push('fallbackConfig.enabled 必须是布尔值');
  }
  if (config.maxRetries !== undefined && (!Number.isInteger(config.maxRetries) || config.maxRetries < 0)) {
    errors.push('fallbackConfig.maxRetries 必须是非负整数');
  }
  if (config.retryOn !== undefined && (!Array.isArray(config.retryOn) || config.retryOn.some((item) => typeof item !== 'string'))) {
    errors.push('fallbackConfig.retryOn 必须是字符串数组');
  }
  if (config.retryStatusCodes !== undefined && (!Array.isArray(config.retryStatusCodes) || config.retryStatusCodes.some((item) => !Number.isInteger(item)))) {
    errors.push('fallbackConfig.retryStatusCodes 必须是整数数组');
  }
  if (config.fallbacks !== undefined && (!Array.isArray(config.fallbacks) || config.fallbacks.some((item) => !item || typeof item !== 'object' || Array.isArray(item)))) {
    errors.push('fallbackConfig.fallbacks 必须是对象数组');
  }
  return errors;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function validateProviderPayload(value: unknown, isUpdate = false): string[] {
  if (!isRecord(value)) return ['请求体必须是 JSON 对象'];

  const errors: string[] = [];
  if (!isUpdate && (typeof value.name !== 'string' || !value.name.trim())) errors.push('name 不能为空');
  if (!isUpdate && (typeof value.type !== 'string' || !value.type.trim())) errors.push('type 不能为空');
  if (value.type !== undefined && (typeof value.type !== 'string' || !value.type.trim())) errors.push('type 必须是非空字符串');
  if (value.protocol !== undefined && value.protocol !== 'openai/v1' && value.protocol !== 'original') errors.push('protocol 必须是 openai/v1 或 original');
  if (value.tokens !== undefined && (!Array.isArray(value.tokens) || value.tokens.some((token) => typeof token !== 'string' || !token.trim()))) errors.push('tokens 必须是非空字符串数组');
  if (!isUpdate && (!Array.isArray(value.tokens) || value.tokens.length === 0)) errors.push('至少需要一个凭据');

  if (value.tokenFailoverConfig !== undefined) {
    const config = value.tokenFailoverConfig;
    if (!isRecord(config) || typeof config.enabled !== 'boolean') {
      errors.push('tokenFailoverConfig 配置无效');
    } else if (config.enabled) {
      for (const field of ['failureThreshold', 'successThreshold', 'healthCheckInterval'] as const) {
        if (!Number.isInteger(config[field]) || (config[field] as number) < 1) errors.push(`tokenFailoverConfig.${field} 必须是正整数`);
      }
      if (typeof config.healthCheckModel !== 'string' || !config.healthCheckModel.trim()) errors.push('tokenFailoverConfig.healthCheckModel 不能为空');
    }
  }
  if (value.rawConfigs !== undefined && !isRecord(value.rawConfigs)) errors.push('rawConfigs 必须是 JSON 对象');
  return errors;
}

export function validateAiRoutePayload(value: unknown, isUpdate = false): string[] {
  if (!isRecord(value)) return ['请求体必须是 JSON 对象'];

  const errors: string[] = [];
  if (!isUpdate && (typeof value.name !== 'string' || !value.name.trim())) errors.push('name 不能为空');
  if (!isUpdate && !isRecord(value.pathPredicate)) errors.push('pathPredicate 必须是对象');
  if (value.pathPredicate !== undefined && (!isRecord(value.pathPredicate) || typeof value.pathPredicate.matchType !== 'string' || typeof value.pathPredicate.matchValue !== 'string' || !value.pathPredicate.matchValue.trim())) errors.push('pathPredicate 配置无效');

  if (!isUpdate && !Array.isArray(value.upstreams)) errors.push('至少需要一个上游');
  if (value.upstreams !== undefined) {
    if (!Array.isArray(value.upstreams) || value.upstreams.length === 0) {
      errors.push('至少需要一个上游');
    } else {
      let totalWeight = 0;
      for (const upstream of value.upstreams) {
        if (!isRecord(upstream) || typeof upstream.provider !== 'string' || !upstream.provider.trim() || !Number.isInteger(upstream.weight) || (upstream.weight as number) < 0 || (upstream.weight as number) > 100) {
          errors.push('上游配置无效');
          continue;
        }
        totalWeight += upstream.weight as number;
        if (upstream.modelMapping !== undefined && !isRecord(upstream.modelMapping)) errors.push('上游模型映射必须是对象');
      }
      if (value.upstreams.length > 1 && totalWeight !== 100) errors.push('多个上游的权重总和必须为 100');
    }
  }

  if (value.authConfig !== undefined) {
    const auth = value.authConfig;
    if (!isRecord(auth) || typeof auth.enabled !== 'boolean' || !Array.isArray(auth.allowedCredentialTypes) || auth.allowedCredentialTypes.some((type) => typeof type !== 'string') || (auth.allowedConsumers !== undefined && (!Array.isArray(auth.allowedConsumers) || auth.allowedConsumers.some((consumer) => typeof consumer !== 'string')))) {
      errors.push('authConfig 配置无效');
    } else if (auth.enabled && auth.allowedCredentialTypes.length === 0) {
      errors.push('启用路由认证时至少需要一种凭据类型');
    }
  }
  if (value.fallbackConfig !== undefined && (!isRecord(value.fallbackConfig) || validateFallbackConfig(value.fallbackConfig as FallbackConfig).length > 0)) errors.push(...(isRecord(value.fallbackConfig) ? validateFallbackConfig(value.fallbackConfig as FallbackConfig) : ['fallbackConfig 必须是 JSON 对象']));
  return errors;
}

export function summarizeFallbackConfig(config: FallbackConfig | undefined): string {
  if (!config || Object.keys(config).length === 0) return '未配置回退策略';
  const parts: string[] = [];
  if (config.enabled === false) parts.push('已禁用');
  if (config.maxRetries !== undefined) parts.push(`最大重试 ${config.maxRetries} 次`);
  if (config.fallbacks?.length) parts.push(`${config.fallbacks.length} 个回退目标`);
  return parts.length > 0 ? parts.join('，') : '已配置回退策略';
}

export function validateModelMappings(rules: ModelMappingRule[]): string[] {
  const errors: string[] = [];
  const exactPatterns = new Set<string>();
  for (const rule of rules) {
    const pattern = rule.pattern.trim();
    if (!pattern) errors.push('模型映射匹配模式不能为空');
    if (!rule.targetModel.trim()) errors.push('模型映射目标模型不能为空');
    if (pattern && !pattern.includes('*') && !pattern.startsWith('~')) {
      if (exactPatterns.has(pattern)) errors.push(`模型映射包含重复精确键: ${pattern}`);
      exactPatterns.add(pattern);
    }
  }
  return errors;
}

export function serializeModelMappings(rules: ModelMappingRule[]): Record<string, string> {
  return Object.fromEntries(
    rules
      .map((rule) => [rule.pattern.trim(), rule.targetModel.trim()] as const)
      .filter(([pattern, targetModel]) => pattern && targetModel)
  );
}

export function validateProviderForm(form: ProviderForm, isUpdate = false): string[] {
  const errors = validateModelMappings(form.modelMappings);
  if (!isUpdate && !form.name.trim()) errors.push('厂商名称不能为空');
  if (!form.type.trim()) errors.push('厂商类型不能为空');
  if (!isUpdate && form.tokens.filter(Boolean).length === 0) errors.push('至少需要一个凭据');
  const failover = form.tokenFailoverConfig;
  if (failover?.enabled) {
    if (failover.failureThreshold < 1) errors.push('失败阈值必须大于等于 1');
    if (failover.successThreshold < 1) errors.push('成功阈值必须大于等于 1');
    if (failover.healthCheckInterval < 1) errors.push('健康检查间隔必须大于等于 1 秒');
    if (!failover.healthCheckModel.trim()) errors.push('健康检查模型不能为空');
  }
  return errors;
}

export function serializeProviderForm(form: ProviderForm, isUpdate = false): CreateLlmProviderRequest | UpdateLlmProviderRequest {
  const rawConfigs = {
    ...(form.baseUrl?.trim() ? { openaiCustomUrl: form.baseUrl.trim() } : {}),
    ...(form.modelMappings.length > 0 ? { modelMapping: serializeModelMappings(form.modelMappings) } : {}),
  };
  const common = {
    type: form.type.trim(),
    protocol: form.protocol,
    ...(form.tokens.filter(Boolean).length > 0 ? { tokens: form.tokens.map((token) => token.trim()).filter(Boolean) } : {}),
    ...(form.tokenFailoverConfig ? { tokenFailoverConfig: form.tokenFailoverConfig } : {}),
    ...(Object.keys(rawConfigs).length > 0 ? { rawConfigs } : {}),
  };
  return isUpdate ? common : { ...common, name: form.name.trim(), tokens: common.tokens ?? [] };
}

export function validateRouteForm(form: RouteForm, providerNames: string[]): string[] {
  const errors: string[] = [];
  if (!form.name.trim()) errors.push('路由名称不能为空');
  if (!form.pathPredicate.matchValue.trim()) errors.push('路径匹配规则不能为空');
  if (form.upstreams.length === 0) errors.push('至少需要一个上游');
  if (form.upstreams.length > 1 && form.upstreams.reduce((sum, upstream) => sum + upstream.weight, 0) !== 100) {
    errors.push('多个上游的权重总和必须为 100');
  }
  for (const upstream of form.upstreams) {
    if (!providerNames.includes(upstream.provider)) errors.push(`上游厂商不存在: ${upstream.provider}`);
    errors.push(...validateModelMappings(upstream.modelMappings));
  }
  if (form.authConfig.enabled && form.authConfig.allowedCredentialTypes.length === 0) {
    errors.push('启用路由认证时至少需要一种凭据类型');
  }
  return errors;
}

// Exact match is expressed to Higress as an anchored REGEX (^value$). Newer
// Higress Console versions accept EXACT directly, but older ones reject it
// with "Unknown matchType"; PRE/REGEX are accepted across versions.
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unescapeRegex(value: string): string {
  return value.replace(/\\([.*+?^${}()|[\]\\])/g, '$1');
}

export function normalizeMatchTypeForApi(
  matchType: string,
  matchValue: string,
): { matchType: string; matchValue: string } {
  if (matchType === 'EXACT') {
    return { matchType: 'REGEX', matchValue: `^${escapeRegex(matchValue)}$` };
  }
  return { matchType, matchValue };
}

export function restoreMatchTypeFromApi(
  matchType: string,
  matchValue: string,
): { matchType: string; matchValue: string } {
  if (
    matchType === 'REGEX' &&
    matchValue.length >= 2 &&
    matchValue.startsWith('^') &&
    matchValue.endsWith('$')
  ) {
    const unescaped = unescapeRegex(matchValue.slice(1, -1));
    if (`^${escapeRegex(unescaped)}$` === matchValue) {
      return { matchType: 'EXACT', matchValue: unescaped };
    }
  }
  return { matchType, matchValue };
}

export function serializeRouteForm(form: RouteForm): CreateAiRouteRequest {
  const pathPredicate = normalizeMatchTypeForApi(form.pathPredicate.matchType, form.pathPredicate.matchValue.trim());
  return {
    name: form.name.trim(),
    pathPredicate: { ...pathPredicate },
    upstreams: form.upstreams.map((upstream) => ({
      provider: upstream.provider,
      weight: upstream.weight,
      modelMapping: serializeModelMappings(upstream.modelMappings),
    })),
    modelPredicates: form.modelPredicates.map((predicate) =>
      normalizeMatchTypeForApi(predicate.matchType, predicate.matchValue),
    ),
    authConfig: {
      enabled: form.authConfig.enabled,
      allowedCredentialTypes: [...form.authConfig.allowedCredentialTypes],
      ...(form.authConfig.allowedConsumers ? { allowedConsumers: [...form.authConfig.allowedConsumers] } : {}),
    },
    ...(form.fallbackConfig ? { fallbackConfig: form.fallbackConfig } : {}),
  };
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
    request<{ routes: AiRoute[]; fallbackConfigWritable?: boolean }>('/api/higress/ai-routes')
      .then((r) => (r.routes ?? []).map((route) => ({
        ...route,
        pathPredicate: {
          ...route.pathPredicate,
          ...restoreMatchTypeFromApi(route.pathPredicate.matchType, route.pathPredicate.matchValue),
        },
        modelPredicates: (route.modelPredicates ?? []).map((predicate) => ({
          ...predicate,
          ...restoreMatchTypeFromApi(predicate.matchType, predicate.matchValue),
        })),
        fallbackConfigWritable: r.fallbackConfigWritable === true,
      }))),

  getRoute: (name: string): Promise<AiRoute> =>
    request<AiRoute>(`/api/higress/ai-routes/${encodeURIComponent(name)}`).then((route) => ({
      ...route,
      pathPredicate: {
        ...route.pathPredicate,
        ...restoreMatchTypeFromApi(route.pathPredicate.matchType, route.pathPredicate.matchValue),
      },
      modelPredicates: (route.modelPredicates ?? []).map((predicate) => ({
        ...predicate,
        ...restoreMatchTypeFromApi(predicate.matchType, predicate.matchValue),
      })),
    })),

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
