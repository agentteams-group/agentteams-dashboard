import { describe, expect, it } from 'vitest';
import { buildModelBindings, hasUnavailableModelAliases } from './model-bindings';

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
});
