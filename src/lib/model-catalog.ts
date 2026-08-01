// Model catalog: built-in model aliases plus user-configured aliases resolved
// from Higress AI routes. The alias list mirrors the official AgentTeams
// controller built-in models (agentteams-controller/internal/agentconfig/generator.go).

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
  // builtin = official built-in alias that still needs a route mapping.
  kind: 'builtin' | 'configured';
  binding?: AgentTeamsModelBinding;
}

export function buildModelSelectionOptions(
  routes: AiRoute[],
  providers: LlmProviderResponse[],
): ModelSelectionOption[] {
  const available = listAvailableRequestModelAliases(routes, providers);
  const configuredAliases = new Set(available.map((binding) => binding.requestModelAlias));
  const options: ModelSelectionOption[] = [
    ...available.map((binding) => ({ alias: binding.requestModelAlias, kind: 'configured' as const, binding })),
    ...BUILTIN_MODEL_ALIASES
      .filter((alias) => !configuredAliases.has(alias))
      .map((alias) => ({ alias, kind: 'builtin' as const })),
  ];
  return options.sort((left, right) => left.alias.localeCompare(right.alias));
}
