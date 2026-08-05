import type { RequestModelAlias } from '@/lib/agentteams-api';
import type { AiRoute, LlmProviderResponse } from '@/lib/higress-api';

export interface AgentTeamsModelBinding {
  requestModelAlias: RequestModelAlias;
  routeName: string;
  providerName: string;
  targetModel: string;
  available: boolean;
  conflict?: boolean;
  passthrough?: boolean;
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
    if (predicate.matchType === 'PRE') {
      const prefix = value.replace(/\*+$/, '');
      return Boolean(prefix) && alias.startsWith(prefix);
    }
    return matchesPattern(alias, value);
  });
}

// Higress ai-proxy / model-mapper semantics for a modelMapping table:
//   - an exact key wins over wildcard keys
//   - `*` is the fallback wildcard (and `gpt-3-*` style prefixes also match)
//   - a target of "" means "keep the original request model name" (passthrough)
//   - no mapping at all also forwards the request model name unchanged
//   - a configured mapping with no matching key makes the request fail
function resolveTargetModel(
  mapping: Record<string, string> | undefined,
  alias: string,
): { target: string; passthrough: boolean } {
  if (!mapping) return { target: alias, passthrough: true };
  const exact = mapping[alias];
  if (typeof exact === 'string') {
    const trimmed = exact.trim();
    return trimmed ? { target: trimmed, passthrough: false } : { target: alias, passthrough: true };
  }
  const matchedPattern = Object.keys(mapping).find((pattern) => matchesPattern(alias, pattern));
  if (matchedPattern !== undefined) {
    const value = mapping[matchedPattern];
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed ? { target: trimmed, passthrough: false } : { target: alias, passthrough: true };
  }
  return { target: '', passthrough: false };
}

// Normalize an untyped mapping value into a Record<string,string>, treating an
// empty (or fully non-string) mapping as "not configured".
function normalizeMapping(mapping: unknown): Record<string, string> | undefined {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(mapping)) {
    if (typeof value === 'string') result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

// Higress maps the *request model name* to a provider-supported model name in
// the provider's rawConfigs.modelMapping (ai-proxy). Its keys are therefore
// valid request model aliases, and a route upstream that lacks its own mapping
// still resolves through the provider mapping.
function providerModelMapping(provider: LlmProviderResponse | undefined): Record<string, string> | undefined {
  return normalizeMapping(provider?.rawConfigs?.modelMapping);
}

// Collect all request model aliases that should appear in the binding table.
// This includes instance aliases (from managers/workers) plus configured
// aliases from route upstream mappings and modelPredicates, ensuring that
// newly configured mappings appear even before any instance uses them.
function collectAllAliases(
  instanceAliases: RequestModelAlias[],
  routes: AiRoute[],
  providers: LlmProviderResponse[],
): Set<string> {
  const aliases = new Set<string>();
  // Instance aliases
  for (const alias of instanceAliases) {
    if (typeof alias === 'string' && alias.trim()) aliases.add(alias.trim());
  }
  // Route upstream modelMapping keys
  for (const route of routes) {
    for (const upstream of route.upstreams) {
      const mapping = normalizeMapping(upstream.modelMapping);
      if (mapping) {
        for (const key of Object.keys(mapping)) {
          if (key && !key.includes('*') && !key.startsWith('~')) aliases.add(key);
        }
      }
    }
    // Route modelPredicates (EXACT)
    for (const predicate of route.modelPredicates ?? []) {
      if (predicate.matchType === 'EXACT') {
        const alias = typeof predicate.matchValue === 'string' ? predicate.matchValue.trim() : '';
        if (alias && !alias.includes('*') && !alias.startsWith('~')) aliases.add(alias);
      }
    }
  }
  // Provider-level modelMapping keys
  for (const provider of providers) {
    const mapping = providerModelMapping(provider);
    if (mapping) {
      for (const key of Object.keys(mapping)) {
        if (key && !key.includes('*') && !key.startsWith('~')) aliases.add(key);
      }
    }
  }
  return aliases;
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
  // Enumerate bindings for all known aliases (instance + configured mappings)
  // so that newly configured mappings appear in the table even before any
  // instance uses them.
  const allAliases = collectAllAliases(aliases, routes, providers);
  // A route may list the same provider twice (e.g. duplicated upstreams), which
  // would otherwise emit fully identical rows for the table. Deduplicate on the
  // (requestModelAlias, routeName, providerName) key, keeping the first row.
  const seenBindings = new Set<string>();
  const bindingKey = (binding: { requestModelAlias: string; routeName: string; providerName: string }) =>
    `${binding.requestModelAlias}\u0000${binding.routeName}\u0000${binding.providerName}`;
  for (const route of routes) {
    const routeAliases = [...allAliases].filter((alias) => routeMatchesAlias(route, alias));

    for (const upstream of route.upstreams) {
      const provider = providersByName.get(upstream.provider);
      const providerMapping = providerModelMapping(provider);
      for (const requestModelAlias of routeAliases) {
        // ai-proxy: when the route upstream declares a modelMapping it fully
        // overrides the provider-level mapping; otherwise the provider mapping
        // applies. No mapping (or a matched mapping with an empty target) means
        // the request model name is forwarded unchanged, which is callable.
        const routeMapping = normalizeMapping(upstream.modelMapping);
        const mapping = routeMapping ?? providerMapping;
        const resolved = resolveTargetModel(mapping, requestModelAlias);
        const targetModel = resolved.passthrough ? requestModelAlias : resolved.target;
        // A binding is passthrough when the route upstream has no explicit
        // modelMapping AND the route has no modelPredicates (empty-predicate
        // routes match all aliases). The binding remains callable but should
        // be visually distinct from an explicit alias-to-target mapping.
        const isPassthrough = resolved.passthrough &&
          (!routeMapping || Object.keys(routeMapping).length === 0) &&
          (!route.modelPredicates || route.modelPredicates.length === 0);
        const binding: AgentTeamsModelBinding = {
          requestModelAlias,
          routeName: route.name,
          providerName: upstream.provider,
          targetModel,
          // Passthrough bindings (empty-predicate route with no explicit mapping)
          // are NOT marked as available since the alias-to-target relationship
          // has not been explicitly configured and verified. They remain
          // callable at the gateway level but should display as "未验证" in the
          // UI so the user knows the mapping is implicit, not explicit.
          available: !isPassthrough && Boolean(provider && targetModel),
          passthrough: isPassthrough,
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

  // Detect conflicts: when the same alias is bound to multiple different routes.
  const aliasRouteCount = new Map<string, number>();
  for (const binding of bindings) {
    if (!binding.conflict) {
      aliasRouteCount.set(binding.requestModelAlias, (aliasRouteCount.get(binding.requestModelAlias) ?? 0) + 1);
    }
  }
  for (const binding of bindings) {
    const count = aliasRouteCount.get(binding.requestModelAlias) ?? 0;
    binding.conflict = count > 1;
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
