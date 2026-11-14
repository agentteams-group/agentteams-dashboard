// Configuration suggestions, not an account's available-model list. Current
// provider IDs checked against the linked official catalogs on 2026-11-14.
// Existing aliases are retained so upgrading does not discard saved values.

import type { AiRoute, LlmProviderResponse } from '@/lib/higress-api';
import { listAvailableRequestModelAliases, type AgentTeamsModelBinding } from '@/lib/model-bindings';

export const PROVIDER_MODEL_PRESETS: Readonly<Record<string, readonly string[]>> = {
  // https://developers.openai.com/api/docs/models
  openai: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna', 'gpt-5.4', 'gpt-5.3-codex', 'gpt-5-mini', 'gpt-5-nano'],
  // https://platform.claude.com/docs/en/models/overview
  claude: ['claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  // https://help.aliyun.com/zh/model-studio/token-plan-team-overview
  qwen: ['qwen4-max-preview', 'qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-max', 'qwen3.7-plus', 'qwen3.6-flash', 'qwen3.6-plus', 'qwen3.5-plus'],
  // https://api-docs.deepseek.com/api/list-models/
  deepseek: ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner'],
  // https://platform.kimi.com/docs/models
  moonshot: ['kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed', 'kimi-k3', 'kimi-k2.5'],
  // https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3
  zhipuai: ['glm-5.3', 'glm-5.2', 'glm-5'],
  // https://platform.minimax.cn/docs/guides/text-generation
  minimax: ['MiniMax-M3.1-Flash', 'MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5'],
  // https://aistudio.google.com/docs/models
  gemini: ['gemini-4-carbon', 'gemini-4-argon', 'gemini-4-hydrogen', 'gemini-3.8-flash'],
  // https://docs.x.ai/developers/models
  grok: ['grok-4.7', 'grok-4.6'],
};

export function providerModelPresets(type: string): readonly string[] {
  return PROVIDER_MODEL_PRESETS[type === 'azure' ? 'openai' : type] ?? [];
}

// These aliases still require a matching gateway route and provider mapping.
export const BUILTIN_MODEL_ALIASES: readonly string[] = [
  ...new Set(Object.values(PROVIDER_MODEL_PRESETS).flat()),
];

const RESPONSES_TOOL_NOTE = '该型号的工具调用需使用 Responses API；Chat Completions 配置不能视为已完成 Agent 工具调用适配。';
export const MODEL_PRESET_NOTES: Readonly<Record<string, string>> = {
  'qwen4-max-preview': '仅支持 Token Plan，预览至北京时间 2026-11-25 24:00。请使用套餐专用 API Key；可通过 OpenAI 兼容服务配置 https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1。',
  'MiniMax-M3': 'MiniMax M3 支持 OpenAI 兼容接口。中国站与国际站分别使用 api.minimax.cn/v1、api.minimax.io/v1，请按 API Key 所属站点配置接入地址。',
  'MiniMax-M3.1-Flash': 'MiniMax M3.1 Flash 支持 OpenAI 兼容接口，始终开启思考。中国站与国际站分别使用 api.minimax.cn/v1、api.minimax.io/v1，请按 API Key 所属站点配置接入地址。',
  'deepseek-flash': 'DeepSeek 官方 API 的 V4.1 Flash ID 为 deepseek-flash；百炼等渠道的模型 ID 可能不同，请按实际接入渠道填写。',
  'kimi-k2.5': 'Kimi 官方平台已下线该型号；已有配置仍保留，新增配置请选 Kimi K3 / K3.1。',
  'gpt-6-astra': RESPONSES_TOOL_NOTE,
  'gpt-6.1-sol': RESPONSES_TOOL_NOTE,
  'gpt-6.1-terra': RESPONSES_TOOL_NOTE,
  'gpt-6-luna': '启用思考的工具调用需使用 Responses API；Chat Completions 工具调用仅支持 reasoning_effort=none。',
};

export interface ModelSelectionOption {
  alias: string;
  // configured = resolvable through an existing Higress AI route + provider;
  // builtin = official built-in alias that still needs a route mapping;
  // sglang = model actually served by a reachable SGLang inference server
  // (server-side, configured via AGENTTEAMS_SGLANG_URL).
  kind: 'builtin' | 'configured' | 'sglang';
  binding?: AgentTeamsModelBinding;
  // Authorization summary of the route resolving this alias (configured
  // options only, #133). A resolvable mapping says nothing about whether a
  // given Worker Consumer may call it; this carries the visible half
  // (auth enabled / allowedConsumers) from GET /api/higress/ai-routes.
  routeAuth?: ModelRouteAuthorization;
}

/** Authorization state of the Higress route resolving a model alias (#133). */
export interface ModelRouteAuthorization {
  enabled: boolean;
  allowedConsumers: string[];
}

/**
 * Human-readable authorization summary for a resolving route (#133). Returns
 * null when the route could not be resolved (nothing to describe).
 */
export function describeRouteAuthorization(auth: ModelRouteAuthorization | undefined): string | null {
  if (!auth) return null;
  if (!auth.enabled) return '路由未启用认证（无 Consumer 限制）';
  if (auth.allowedConsumers.length === 0) return '已启用认证，未限定 Consumer';
  return `授权 Consumer：${auth.allowedConsumers.join('、')}`;
}

/** provider / model 候选目录（选择器与自由输入共用同一份派生结果）。 */
export interface ModelCandidateCatalog {
  /** 网关 provider 名（去重排序）。 */
  providers: string[];
  /** 请求模型 alias（去重排序）。 */
  models: string[];
  /** provider → 该 provider 承载的 alias（供先选 provider 再筛模型）。 */
  modelsByProvider: Record<string, string[]>;
  /** alias → provider（选模型后反查，自动补 provider）。 */
  providerByModel: Record<string, string>;
}

/**
 * 从模型选择项派生 (provider, model) 候选目录。
 *
 * 只收 binding.providerName —— 没有路由映射的 alias（内置模板 / SGLang）
 * 不归属任何 provider，仍留在 models 里供自由输入与模型名选择。
 */
export function buildModelCandidateCatalog(
  options: readonly ModelSelectionOption[],
): ModelCandidateCatalog {
  const providers = new Set<string>();
  const models = new Set<string>();
  const modelsByProvider: Record<string, string[]> = {};
  const providerByModel: Record<string, string> = {};
  for (const option of options) {
    const alias = option.alias.trim();
    if (!alias) continue;
    models.add(alias);
    const provider = (option.binding?.providerName ?? '').trim();
    if (!provider) continue;
    providers.add(provider);
    const bucket = (modelsByProvider[provider] ??= []);
    if (!bucket.includes(alias)) bucket.push(alias);
    if (!providerByModel[alias]) providerByModel[alias] = provider;
  }
  for (const bucket of Object.values(modelsByProvider)) bucket.sort((a, b) => a.localeCompare(b));
  return {
    providers: [...providers].sort((a, b) => a.localeCompare(b)),
    models: [...models].sort((a, b) => a.localeCompare(b)),
    modelsByProvider,
    providerByModel,
  };
}

/**
 * 当前 provider 下的模型候选：命中映射 → 该 provider 的 alias；无映射
 * （空 provider / 未配置路由）→ 全部候选，不误伤自由输入场景。
 */
export function modelOptionsForProvider(
  catalog: ModelCandidateCatalog,
  provider: string,
): string[] {
  const key = provider.trim();
  const mapped = key ? catalog.modelsByProvider[key] : undefined;
  return mapped && mapped.length > 0 ? mapped : catalog.models;
}

export function buildModelSelectionOptions(
  routes: AiRoute[],
  providers: LlmProviderResponse[],
  sglangModels: readonly string[] = [],
): ModelSelectionOption[] {
  const available = listAvailableRequestModelAliases(routes, providers);
  const configuredAliases = new Set(available.map((binding) => binding.requestModelAlias));
  const routesByName = new Map(routes.map((route) => [route.name, route]));
  const aliasLayer: ModelSelectionOption[] = [
    ...available.map((binding) => {
      const route = binding.routeName ? routesByName.get(binding.routeName) : undefined;
      return {
        alias: binding.requestModelAlias,
        kind: 'configured' as const,
        binding,
        routeAuth: route
          ? {
              enabled: route.authConfig?.enabled ?? false,
              allowedConsumers: route.authConfig?.allowedConsumers ?? [],
            }
          : undefined,
      };
    }),
    ...BUILTIN_MODEL_ALIASES
      .filter((alias) => !configuredAliases.has(alias))
      .map((alias) => ({ alias, kind: 'builtin' as const })),
  ];
  // SGLang serving layer: models actually served by the local inference
  // server. On name collision the alias layer (configured + builtin) wins —
  // a routed alias carries binding truth that a bare SGLang id cannot.
  const aliasNames = new Set(aliasLayer.map((option) => option.alias));
  const sglangLayer: ModelSelectionOption[] = [...new Set(sglangModels)]
    .filter((alias) => alias.length > 0 && !aliasNames.has(alias))
    .map((alias) => ({ alias, kind: 'sglang' as const }));
  return [...aliasLayer, ...sglangLayer].sort((left, right) => left.alias.localeCompare(right.alias));
}
