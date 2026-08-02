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
    const raw = predicate.matchValue;
    const value = typeof raw === 'string' ? raw.trim() : '';
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

// Higress maps the *request model name* to a provider-supported model name in
// the provider's rawConfigs.modelMapping (ai-proxy). Its keys are therefore
// valid request model aliases, and a route upstream that lacks its own mapping
// still resolves through the provider mapping. Guard against non-string values
// because rawConfigs is untyped in the Console response.
function providerModelMapping(provider: LlmProviderResponse | undefined): Record<string, string> | undefined {
  if (!provider) return undefined;
  const mapping = provider.rawConfigs?.modelMapping;
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(mapping)) {
    if (typeof value === 'string') result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function buildModelBindings(
  aliases: RequestModelAlias[],
  routes: AiRoute[],
  providers: LlmProviderResponse[],
): AgentTeamsModelBinding[] {
  const providersByName = new Map(providers.map((provider) => [provider.name, provider]));
  let bindings: AgentTeamsModelBinding[] = [];

  // Backend may omit `model` on managers/workers, producing undefined entries.
  // Guard against non-string aliases so alias.trim() does not throw.
  const requestedAliases = new Set(
    aliases
      .filter((alias): alias is RequestModelAlias => typeof alias === 'string')
      .map((alias) => alias.trim())
      .filter(Boolean),
  );
  // A route may list the same provider twice (e.g. duplicated upstreams), which
  // would otherwise emit fully identical rows for the table. Deduplicate on the
  // (requestModelAlias, routeName, providerName) key, keeping the first row.
  const seenBindings = new Set<string>();
  const bindingKey = (binding: { requestModelAlias: string; routeName: string; providerName: string }) =>
    `${binding.requestModelAlias}\u0000${binding.routeName}\u0000${binding.providerName}`;
  for (const route of routes) {
    const routeAliases = [...requestedAliases].filter((alias) => routeMatchesAlias(route, alias));

    for (const upstream of route.upstreams) {
      const provider = providersByName.get(upstream.provider);
      // Route-level mapping wins; fall back to the provider-level mapping when
      // the upstream has no entry for this alias.
      const providerMapping = providerModelMapping(provider);
      for (const requestModelAlias of routeAliases) {
        const targetModel =
          targetModelForAlias(upstream.modelMapping, requestModelAlias) ||
          targetModelForAlias(providerMapping, requestModelAlias);
        const binding: AgentTeamsModelBinding = {
          requestModelAlias,
          routeName: route.name,
          providerName: upstream.provider,
          targetModel,
          available: Boolean(provider && provider.tokenCount > 0 && targetModel),
        };
        const key = bindingKey(binding);
        if (seenBindings.has(key)) continue;
        seenBindings.add(key);
        bindings.push(binding);
      }
    }
  }

  // When an alias already resolves through a usable binding, drop the
  // unresolvable rows for the same alias (e.g. the default onboarding route
  // matching every alias against a provider that is not actually configured).
  // This keeps the table showing one meaningful row per available alias while
  // still surfacing unresolvable aliases that have no usable binding at all.
  const availableAliases = new Set(
    bindings.filter((binding) => binding.available).map((binding) => binding.requestModelAlias),
  );
  bindings = bindings.filter(
    (binding) => binding.available || !availableAliases.has(binding.requestModelAlias),
  );

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
  return [...new Set(aliases
    .filter((alias): alias is RequestModelAlias => typeof alias === 'string')
    .map((alias) => alias.trim())
    .filter(Boolean))].some(
    (alias) => !bindings.some((binding) => binding.requestModelAlias === alias && binding.available),
  );
}

export function listAvailableRequestModelAliases(
  routes: AiRoute[],
  providers: LlmProviderResponse[],
): AgentTeamsModelBinding[] {
  const aliases = new Set<string>();

  for (const route of routes) {
    for (const predicate of route.modelPredicates ?? []) {
      const alias = typeof predicate.matchValue === 'string' ? predicate.matchValue.trim() : '';
      if (predicate.matchType === 'EXACT' && alias && !alias.includes('*') && !alias.startsWith('~')) {
        aliases.add(alias);
      }
    }
    for (const upstream of route.upstreams) {
      for (const alias of Object.keys(upstream.modelMapping ?? {})) {
        // Wildcard and regular-expression mappings accept administrator-provided
        // concrete aliases, so only exact mappings can be offered as fixed choices.
        if (alias && !alias.includes('*') && !alias.startsWith('~')) aliases.add(alias);
      }
    }
  }
  // Provider-level modelMapping keys are request model names too (ai-proxy maps
  // the request model to a provider-supported model), so a provider-only
  // mapping must be selectable even before a route upstream repeats it.
  for (const provider of providers) {
    const mapping = providerModelMapping(provider);
    if (!mapping) continue;
    for (const alias of Object.keys(mapping)) {
      if (alias && !alias.includes('*') && !alias.startsWith('~')) aliases.add(alias);
    }
  }

  return buildModelBindings([...aliases], routes, providers).filter((binding) => binding.available);
}
