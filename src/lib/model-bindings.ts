import type { RequestModelAlias } from '@/lib/agentteams-api';
import type { AiRoute, LlmProviderResponse } from '@/lib/higress-api';

export interface AgentTeamsModelBinding {
  requestModelAlias: RequestModelAlias;
  routeName: string;
  providerName: string;
  targetModel: string;
  available: boolean;
}

function matchesPattern(value: string, pattern: string): boolean {
  if (!pattern.includes('*')) return value === pattern;
  const expression = `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*')}$`;
  return new RegExp(expression).test(value);
}

function routeMatchesAlias(route: AiRoute, alias: string): boolean {
  const predicates = route.modelPredicates ?? [];
  if (predicates.length === 0) return true;
  return predicates.some((predicate) => {
    const value = predicate.matchValue.trim();
    if (!value) return false;
    return predicate.matchType === 'PRE' ? alias.startsWith(value) : matchesPattern(alias, value);
  });
}

function targetModelForAlias(mapping: Record<string, string> | undefined, alias: string): string {
  if (!mapping) return '';
  const exact = mapping[alias]?.trim();
  if (exact) return exact;
  const matchedPattern = Object.keys(mapping).find((pattern) => matchesPattern(alias, pattern));
  return matchedPattern ? mapping[matchedPattern].trim() : '';
}

export function buildModelBindings(
  aliases: RequestModelAlias[],
  routes: AiRoute[],
  providers: LlmProviderResponse[],
): AgentTeamsModelBinding[] {
  const providersByName = new Map(providers.map((provider) => [provider.name, provider]));
  const bindings: AgentTeamsModelBinding[] = [];

  const requestedAliases = new Set(aliases.map((alias) => alias.trim()).filter(Boolean));
  for (const route of routes) {
    const routeAliases = [...requestedAliases].filter((alias) => routeMatchesAlias(route, alias));

    for (const upstream of route.upstreams) {
      const provider = providersByName.get(upstream.provider);
      for (const requestModelAlias of routeAliases) {
        const targetModel = targetModelForAlias(upstream.modelMapping, requestModelAlias);
        bindings.push({
          requestModelAlias,
          routeName: route.name,
          providerName: upstream.provider,
          targetModel,
          available: Boolean(provider && provider.tokenCount > 0 && targetModel),
        });
      }
    }
  }

  for (const requestModelAlias of requestedAliases) {
    if (!bindings.some((binding) => binding.requestModelAlias === requestModelAlias)) {
      bindings.push({
        requestModelAlias,
        routeName: '',
        providerName: '',
        targetModel: '',
        available: false,
      });
    }
  }

  return bindings.sort((left, right) =>
    left.requestModelAlias.localeCompare(right.requestModelAlias) ||
    left.routeName.localeCompare(right.routeName) ||
    left.providerName.localeCompare(right.providerName),
  );
}

export function hasUnavailableModelAliases(
  aliases: RequestModelAlias[],
  bindings: AgentTeamsModelBinding[],
): boolean {
  return [...new Set(aliases.map((alias) => alias.trim()).filter(Boolean))].some(
    (alias) => !bindings.some((binding) => binding.requestModelAlias === alias && binding.available),
  );
}
