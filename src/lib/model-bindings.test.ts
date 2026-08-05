import { describe, expect, it } from 'vitest';
import { buildModelBindings, hasUnavailableModelAliases, listAvailableRequestModelAliases } from './model-bindings';

describe('model bindings', () => {
  it('marks an alias available when its route, provider, and target model are available', () => {
    const bindings = buildModelBindings(
      ['team-chat'],
      [{
        name: 'chat',
        pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
        upstreams: [{ provider: 'openai', weight: 100, modelMapping: { 'team-chat': 'gpt-4.1' } }],
      }],
      [{ name: 'openai', type: 'openai', tokenCount: 1 }],
    );

    expect(bindings).toMatchObject([{
      requestModelAlias: 'team-chat',
      routeName: 'chat',
      providerName: 'openai',
      targetModel: 'gpt-4.1',
      available: true,
    }]);
    expect(hasUnavailableModelAliases(['team-chat'], bindings)).toBe(false);
  });

  it('marks aliases without a configured target model as unavailable', () => {
    const bindings = buildModelBindings(
      ['legacy-provider'],
      [{
        name: 'chat',
        pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
        upstreams: [{ provider: 'missing-provider', weight: 100 }],
        modelPredicates: [{ matchType: 'EXACT', matchValue: 'legacy-provider' }],
      }],
      [],
    );

    expect(bindings[0]).toMatchObject({
      requestModelAlias: 'legacy-provider',
      routeName: 'chat',
      providerName: 'missing-provider',
      available: false,
    });
    expect(hasUnavailableModelAliases(['legacy-provider'], bindings)).toBe(true);
  });

  it('resolves wildcard mappings only for aliases matched by route predicates', () => {
    const bindings = buildModelBindings(
      ['team-chat', 'other-chat'],
      [{
        name: 'team-route',
        pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
        modelPredicates: [{ matchType: 'PRE', matchValue: 'team-' }],
        upstreams: [{ provider: 'openai', weight: 100, modelMapping: { '*': 'gpt-4.1' } }],
      }],
      [{ name: 'openai', type: 'openai', tokenCount: 1 }],
    );

    expect(bindings).toContainEqual(expect.objectContaining({
      requestModelAlias: 'team-chat', routeName: 'team-route', providerName: 'openai', targetModel: 'gpt-4.1', available: true,
    }));
    expect(hasUnavailableModelAliases(['team-chat'], bindings)).toBe(false);
    expect(hasUnavailableModelAliases(['other-chat'], bindings)).toBe(true);
  });

  it('does not throw when a manager/worker omits model (undefined alias)', () => {
    // Backend may return agents without a `model` field; this previously threw
    // "Cannot read properties of undefined (reading 'trim')" on the gateway page.
    const route = {
      name: 'chat',
      pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
      upstreams: [{ provider: 'openai', weight: 100, modelMapping: { 'team-chat': 'gpt-4.1' } }],
    };

    expect(() => buildModelBindings(
      [undefined as unknown as string, 'team-chat'],
      [route],
      [{ name: 'openai', type: 'openai', tokenCount: 1 }],
    )).not.toThrow();
  });

  it('does not throw when a model predicate is missing matchValue', () => {
    // Backend may omit matchValue; this previously threw
    // "Cannot read properties of undefined (reading 'trim')".
    const route = {
      name: 'chat',
      pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
      modelPredicates: [{ matchType: 'EXACT' } as { matchType: string; matchValue: string }],
      upstreams: [{ provider: 'openai', weight: 100, modelMapping: { 'team-chat': 'gpt-4.1' } }],
    };

    expect(() => buildModelBindings(['team-chat'], [route], [{ name: 'openai', type: 'openai', tokenCount: 1 }])).not.toThrow();
  });

  it('does not emit duplicate bindings when a route lists the same provider twice', () => {
    const bindings = buildModelBindings(
      ['team-chat'],
      [{
        name: 'chat',
        pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
        upstreams: [
          { provider: 'openai', weight: 50, modelMapping: { 'team-chat': 'gpt-4.1' } },
          { provider: 'openai', weight: 50, modelMapping: { 'team-chat': 'gpt-4.1' } },
        ],
      }],
      [{ name: 'openai', type: 'openai', tokenCount: 1 }],
    );

    expect(bindings.filter((binding) => binding.requestModelAlias === 'team-chat')).toEqual([{
      requestModelAlias: 'team-chat',
      routeName: 'chat',
      providerName: 'openai',
      targetModel: 'gpt-4.1',
      available: true,
      conflict: false,
      passthrough: false,
    }]);
    const keys = bindings.map((binding) => `${binding.requestModelAlias}\u0000${binding.routeName}\u0000${binding.providerName}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('lists exact aliases that users can select in Manager and Worker forms', () => {
    const aliases = listAvailableRequestModelAliases(
      [{
        name: 'chat',
        pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
        modelPredicates: [{ matchType: 'EXACT', matchValue: 'team-chat' }],
        upstreams: [{ provider: 'openai', weight: 100, modelMapping: { '*': 'gpt-4.1' } }],
      }],
      [{ name: 'openai', type: 'openai', tokenCount: 1 }],
    );

    expect(aliases).toEqual([{
      requestModelAlias: 'team-chat',
      routeName: 'chat',
      providerName: 'openai',
      targetModel: 'gpt-4.1',
      available: true,
      conflict: false,
      passthrough: false,
    }]);
  });

  it('resolves a target model from the provider-level modelMapping when the upstream has none', () => {
    const bindings = buildModelBindings(
      ['team-chat'],
      [{
        name: 'chat',
        pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
        upstreams: [{ provider: 'openai', weight: 100, modelMapping: {} }],
      }],
      [{ name: 'openai', type: 'openai', tokenCount: 1, rawConfigs: { modelMapping: { 'team-chat': 'gpt-4.1' } } }],
    );

    expect(bindings).toEqual([{
      requestModelAlias: 'team-chat',
      routeName: 'chat',
      providerName: 'openai',
      targetModel: 'gpt-4.1',
      available: true,
      conflict: false,
      passthrough: false,
    }]);
  });

  it('offers provider-level mapping keys as selectable aliases', () => {
    const aliases = listAvailableRequestModelAliases(
      [{
        name: 'chat',
        pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
        upstreams: [{ provider: 'openai', weight: 100, modelMapping: {} }],
      }],
      [{ name: 'openai', type: 'openai', tokenCount: 1, rawConfigs: { modelMapping: { 'team-chat': 'gpt-4.1' } } }],
    );

    expect(aliases).toEqual([{
      requestModelAlias: 'team-chat',
      routeName: 'chat',
      providerName: 'openai',
      targetModel: 'gpt-4.1',
      available: true,
      conflict: false,
      passthrough: false,
    }]);
  });

  it('drops unresolvable noise rows when the same alias already has an available binding', () => {
    // The onboarding route matches every alias against a provider that is not
    // actually configured; once the real route resolves the alias it must be
    // the only row shown for that alias.
    const bindings = buildModelBindings(
      ['team-chat'],
      [
        {
          name: 'agentteams-default',
          pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
          upstreams: [{ provider: 'openai-compat', weight: 100, modelMapping: {} }],
        },
        {
          name: 'chat',
          pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
          upstreams: [{ provider: 'openai', weight: 100, modelMapping: { 'team-chat': 'gpt-4.1' } }],
        },
      ],
      [{ name: 'openai', type: 'openai', tokenCount: 1 }],
    );

    expect(bindings).toEqual([{
      requestModelAlias: 'team-chat',
      routeName: 'chat',
      providerName: 'openai',
      targetModel: 'gpt-4.1',
      available: true,
      conflict: false,
      passthrough: false,
    }]);
  });

  it('treats an upstream without any modelMapping as a passthrough (unverified)', () => {
    // Higress ai-proxy forwards the request model name unchanged when neither
    // the route upstream nor the provider declares a mapping. The binding is
    // technically callable but should NOT be marked as "available" since the
    // alias-to-target relationship has not been explicitly configured.
    const bindings = buildModelBindings(
      ['sensenova-6.7-flash-lite'],
      [{
        name: 'default-ai-route',
        pathPredicate: { matchType: 'PRE', matchValue: '/v1' },
        upstreams: [{ provider: 'openai-compat', weight: 100 }],
      }],
      [{ name: 'openai-compat', type: 'openai', tokenCount: 1 }],
    );

    expect(bindings).toEqual([{
      requestModelAlias: 'sensenova-6.7-flash-lite',
      routeName: 'default-ai-route',
      providerName: 'openai-compat',
      targetModel: 'sensenova-6.7-flash-lite',
      available: false,
      passthrough: true,
      conflict: false,
    }]);
  });

  it('treats an empty-string mapping target as a callable passthrough', () => {
    // model-mapper semantics: a target of "" keeps the original model name.
    const bindings = buildModelBindings(
      ['team-chat'],
      [{
        name: 'chat',
        pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
        upstreams: [{ provider: 'openai', weight: 100, modelMapping: { '*': '' } }],
      }],
      [{ name: 'openai', type: 'openai', tokenCount: 1 }],
    );

    expect(bindings).toEqual([{
      requestModelAlias: 'team-chat',
      routeName: 'chat',
      providerName: 'openai',
      targetModel: 'team-chat',
      available: true,
      conflict: false,
      passthrough: false,
    }]);
  });

  it('keeps an alias unavailable when a route mapping exists but does not match', () => {
    // Once a route upstream declares its own modelMapping it overrides the
    // provider-level mapping; a request model with no matching key fails, so
    // it must not fall back to the provider mapping.
    const bindings = buildModelBindings(
      ['sensenova-6.7-flash-lite'],
      [{
        name: 'ark',
        pathPredicate: { matchType: 'PRE', matchValue: '/v1' },
        modelPredicates: [{ matchType: 'PRE', matchValue: 'sensenova-' }],
        upstreams: [{ provider: 'ark', weight: 100, modelMapping: { 'ark-code-latest': 'ark-code-latest' } }],
      }],
      [{ name: 'ark', type: 'ark', tokenCount: 1, rawConfigs: { modelMapping: { 'sensenova-6.7-flash-lite': 'ep-sensenova' } } }],
    );

    expect(bindings).toEqual([{
      requestModelAlias: 'sensenova-6.7-flash-lite',
      routeName: 'ark',
      providerName: 'ark',
      targetModel: '',
      available: false,
      conflict: false,
      passthrough: false,
    }]);
  });

  it('resolves a provider mapping when the route upstream declares none', () => {
    // A route upstream that only sets provider/weight still resolves aliases
    // through the provider-level modelMapping.
    const bindings = buildModelBindings(
      ['ark-code-latest'],
      [{
        name: 'ark',
        pathPredicate: { matchType: 'PRE', matchValue: '/v1' },
        modelPredicates: [{ matchType: 'PRE', matchValue: 'ark-' }],
        upstreams: [{ provider: 'ark', weight: 100 }],
      }],
      [{ name: 'ark', type: 'ark', tokenCount: 1, rawConfigs: { modelMapping: { 'ark-code-latest': 'ep-ark' } } }],
    );

    expect(bindings).toEqual([{
      requestModelAlias: 'ark-code-latest',
      routeName: 'ark',
      providerName: 'ark',
      targetModel: 'ep-ark',
      available: true,
      conflict: false,
      passthrough: false,
    }]);
  });

  it('marks a binding as passthrough when a route has empty predicates and no upstream mapping', () => {
    // Empty-predicate routes match all aliases; without explicit upstream mapping
    // the binding is a passthrough. Since the alias-to-target relationship is
    // implicit, the binding should NOT be marked as available in the UI.
    const bindings = buildModelBindings(
      ['sensenova-6.7-flash-lite'],
      [{
        name: 'default-ai-route',
        pathPredicate: { matchType: 'PRE', matchValue: '/v1' },
        upstreams: [{ provider: 'openai-compat', weight: 100 }],
      }],
      [{ name: 'openai-compat', type: 'openai', tokenCount: 1 }],
    );

    expect(bindings).toEqual([{
      requestModelAlias: 'sensenova-6.7-flash-lite',
      routeName: 'default-ai-route',
      providerName: 'openai-compat',
      targetModel: 'sensenova-6.7-flash-lite',
      available: false,
      passthrough: true,
      conflict: false,
    }]);
  });

  it('does not mark a binding as passthrough when the route has explicit modelPredicates', () => {
    const bindings = buildModelBindings(
      ['team-chat'],
      [{
        name: 'chat',
        pathPredicate: { matchType: 'PRE', matchValue: '/v1' },
        modelPredicates: [{ matchType: 'EXACT', matchValue: 'team-chat' }],
        upstreams: [{ provider: 'openai', weight: 100 }],
      }],
      [{ name: 'openai', type: 'openai', tokenCount: 1 }],
    );

    expect(bindings).toEqual([{
      requestModelAlias: 'team-chat',
      routeName: 'chat',
      providerName: 'openai',
      targetModel: 'team-chat',
      available: true,
      passthrough: false,
      conflict: false,
    }]);
  });

  it('marks bindings as conflicting when the same alias matches multiple routes', () => {
    // Two routes with empty modelPredicates both match the same alias.
    const bindings = buildModelBindings(
      ['team-chat'],
      [
        {
          name: 'default-ai-route',
          pathPredicate: { matchType: 'PRE', matchValue: '/v1' },
          upstreams: [{ provider: 'openai', weight: 100 }],
        },
        {
          name: 'agentteams-team',
          pathPredicate: { matchType: 'PRE', matchValue: '/v1' },
          upstreams: [{ provider: 'deepseek', weight: 100 }],
        },
      ],
      [{ name: 'openai', type: 'openai', tokenCount: 1 }, { name: 'deepseek', type: 'deepseek', tokenCount: 1 }],
    );

    expect(bindings).toContainEqual(
      expect.objectContaining({ requestModelAlias: 'team-chat', conflict: true }),
    );
  });

  it('does not show conflict when explicit binding is available over passthrough', () => {
    // When a specific route already provides an available binding for an alias,
    // the empty-predicate route's passthrough binding is filtered out rather
    // than shown as a conflict.
    const bindings = buildModelBindings(
      ['team-chat'],
      [
        {
          name: 'default-ai-route',
          pathPredicate: { matchType: 'PRE', matchValue: '/v1' },
          upstreams: [{ provider: 'openai', weight: 100 }],
        },
        {
          name: 'agentteams-team',
          pathPredicate: { matchType: 'PRE', matchValue: '/v1' },
          modelPredicates: [{ matchType: 'EXACT', matchValue: 'team-chat' }],
          upstreams: [{ provider: 'deepseek', weight: 100, modelMapping: { 'team-chat': 'deepseek-v3' } }],
        },
      ],
      [{ name: 'openai', type: 'openai', tokenCount: 1 }, { name: 'deepseek', type: 'deepseek', tokenCount: 1 }],
    );

    // Only agentteams-team binding remains; default-ai-route passthrough is filtered out
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toEqual(expect.objectContaining({
      requestModelAlias: 'team-chat',
      routeName: 'agentteams-team',
      available: true,
      conflict: false,
    }));
  });

  it('enumerates configured mapping keys even when no instance uses them', () => {
    // Bug scenario: adding a model mapping (test-qwen3.6 -> qwen3.6-plus) to a
    // new provider creates agentteams-test with modelPredicates and upstream
    // modelMapping, but the binding table was empty because no instance used
    // test-qwen3.6 yet.
    const bindings = buildModelBindings(
      // Workers still use qwen3.6-plus; test-qwen3.6 has not been selected
      ['qwen3.6-plus', 'qwen3.6-plus', 'qwen3.6-plus'],
      [
        {
          name: 'default-ai-route',
          pathPredicate: { matchType: 'PRE', matchValue: '/v1' },
          upstreams: [{ provider: 'openai-compat', weight: 100 }],
        },
        {
          name: 'agentteams-test',
          pathPredicate: { matchType: 'PRE', matchValue: '/v1' },
          modelPredicates: [{ matchType: 'EXACT', matchValue: 'test-qwen3.6' }],
          upstreams: [{ provider: 'test', weight: 100, modelMapping: { 'test-qwen3.6': 'qwen3.6-plus' } }],
        },
      ],
      [
        { name: 'openai-compat', type: 'openai', tokenCount: 1 },
        { name: 'test', type: 'openai', tokenCount: 1 },
      ],
    );

    // test-qwen3.6 should appear as available even though no instance uses it
    const testBinding = bindings.find((b) => b.requestModelAlias === 'test-qwen3.6');
    expect(testBinding).toBeDefined();
    expect(testBinding).toMatchObject({
      requestModelAlias: 'test-qwen3.6',
      routeName: 'agentteams-test',
      providerName: 'test',
      targetModel: 'qwen3.6-plus',
      available: true,
      conflict: false,
      passthrough: false,
    });
    // qwen3.6-plus should NOT be shown as available from default-ai-route
    const qwenPassthrough = bindings.find((b) =>
      b.requestModelAlias === 'qwen3.6-plus' && b.routeName === 'default-ai-route',
    );
    expect(qwenPassthrough?.available).toBe(false);
    expect(qwenPassthrough?.passthrough).toBe(true);
  });

  it('shows explicit-mapping binding instead of passthrough for same alias on conflicting routes', () => {
    // When a specific route (agentteams-test) has an explicit mapping for an
    // alias that also matches default-ai-route via passthrough, the binding
    // table should show the explicit mapping, not the passthrough.
    const bindings = buildModelBindings(
      ['test-qwen3.6'],
      [
        {
          name: 'default-ai-route',
          pathPredicate: { matchType: 'PRE', matchValue: '/v1' },
          upstreams: [{ provider: 'openai-compat', weight: 100 }],
        },
        {
          name: 'agentteams-test',
          pathPredicate: { matchType: 'PRE', matchValue: '/v1' },
          modelPredicates: [{ matchType: 'EXACT', matchValue: 'test-qwen3.6' }],
          upstreams: [{ provider: 'test', weight: 100, modelMapping: { 'test-qwen3.6': 'qwen3.6-plus' } }],
        },
      ],
      [
        { name: 'openai-compat', type: 'openai', tokenCount: 1 },
        { name: 'test', type: 'openai', tokenCount: 1 },
      ],
    );

    // The explicit binding wins; default-ai-route passthrough is filtered out
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toEqual(expect.objectContaining({
      requestModelAlias: 'test-qwen3.6',
      routeName: 'agentteams-test',
      available: true,
      conflict: false,
    }));
  });

  it('filters passthrough when explicit available binding exists for the same alias', () => {
    // User scenario: workers switched to test-qwen3.6. agentteams-test has
    // modelPredicates + upstream mapping; default-ai-route is empty-predicate.
    // The passthrough row must be filtered out, not shown alongside the
    // explicit binding.
    const bindings = buildModelBindings(
      ['test-qwen3.6', 'test-qwen3.6', 'test-qwen3.6'],
      [
        {
          name: 'default-ai-route',
          pathPredicate: { matchType: 'PRE', matchValue: '/v1' },
          upstreams: [{ provider: 'openai-compat', weight: 100 }],
        },
        {
          name: 'agentteams-test',
          pathPredicate: { matchType: 'PRE', matchValue: '/v1' },
          modelPredicates: [{ matchType: 'EXACT', matchValue: 'test-qwen3.6' }],
          upstreams: [{ provider: 'test', weight: 100, modelMapping: { 'test-qwen3.6': 'qwen3.6-plus' } }],
        },
      ],
      [
        { name: 'openai-compat', type: 'openai', tokenCount: 1 },
        { name: 'test', type: 'openai', tokenCount: 1 },
      ],
    );
    // Only agentteams-test row; default-ai-route passthrough is filtered out
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      requestModelAlias: 'test-qwen3.6',
      routeName: 'agentteams-test',
      targetModel: 'qwen3.6-plus',
      available: true,
      conflict: false,
      passthrough: false,
    });
  });

  it('strips trailing * from PRE predicate matchValue before prefix matching', () => {
    // Higress Console stores PRE predicates with a wildcard suffix like "kimi-*"
    // which must be matched as a literal prefix after stripping the trailing *.
    const bindings = buildModelBindings(
      ['kimi-k3'],
      [{
        name: 'ark',
        pathPredicate: { matchType: 'PRE', matchValue: '/v3' },
        modelPredicates: [{ matchType: 'PRE', matchValue: 'kimi-*' }],
        upstreams: [{ provider: 'ark', weight: 100, modelMapping: { 'kimi-k3': 'kimi-k3' } }],
      }],
      [{ name: 'ark', type: 'openai', tokenCount: 1 }],
    );
    expect(bindings[0]).toMatchObject({
      requestModelAlias: 'kimi-k3',
      routeName: 'ark',
      available: true,
    });
  });
});
