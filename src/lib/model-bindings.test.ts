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

    expect(bindings).toEqual([{
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

    expect(bindings).toContainEqual({
      requestModelAlias: 'team-chat', routeName: 'team-route', providerName: 'openai', targetModel: 'gpt-4.1', available: true,
    });
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
    }]);
  });
});
