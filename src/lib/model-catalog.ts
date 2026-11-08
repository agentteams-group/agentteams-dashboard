// Model catalog: built-in model aliases plus user-configured aliases resolved
// from Higress AI routes. The alias list mirrors the official AgentTeams
// controller built-in models. Verified against agentscope-ai/AgentTeams
// tag v1.2.0 (commit 793db24), agentteams-controller/internal/agentconfig/generator.go.

import type { AiRoute, LlmProviderResponse } from '@/lib/higress-api';
import { listAvailableRequestModelAliases, type AgentTeamsModelBinding } from '@/lib/model-bindings';

// Built-in request model aliases shipped by AgentTeams v1.2.0. Selecting one of
// these only names the request model; the actual routing still requires a
// matching Higress AI route + provider mapping.
export const BUILTIN_MODEL_ALIASES: readonly string[] = [
  'gpt-5.4',
  'gpt-5.3-codex',
  'gpt-5-mini',
  'gpt-5-nano',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'qwen3.6-plus',
  'qwen3.5-plus',
  'deepseek-chat',
  'deepseek-reasoner',
  'kimi-k2.5',
  'glm-5',
  'MiniMax-M2.7',
  'MiniMax-M2.7-highspeed',
  'MiniMax-M2.5',
];

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
