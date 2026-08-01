import { describe, expect, it } from 'vitest';
import {
  serializeProviderForm,
  serializeRouteForm,
  normalizeMatchTypeForApi,
  restoreMatchTypeFromApi,
  parseFallbackConfig,
  summarizeFallbackConfig,
  validateProviderForm,
  validateRouteForm,
  validateProviderPayload,
  validateAiRoutePayload,
  type ProviderForm,
  type RouteForm,
} from './higress-api';

describe('Higress form serialization', () => {
  const provider: ProviderForm = {
    name: 'openai',
    type: 'openai',
    protocol: 'openai/v1',
    tokens: [' token-a '],
    baseUrl: 'https://api.example.test/v1',
    modelMappings: [{ pattern: 'team-chat', targetModel: 'gpt-4.1' }],
  };

  it('serializes provider base URL and model mappings', () => {
    expect(serializeProviderForm(provider)).toEqual({
      name: 'openai',
      type: 'openai',
      protocol: 'openai/v1',
      tokens: ['token-a'],
      rawConfigs: {
        openaiCustomUrl: 'https://api.example.test/v1',
        modelMapping: { 'team-chat': 'gpt-4.1' },
      },
    });
  });

  it('omits empty tokens from provider updates', () => {
    expect(serializeProviderForm({ ...provider, tokens: [] }, true)).not.toHaveProperty('tokens');
  });

  it('keeps a configured token failover policy in provider payloads', () => {
    const tokenFailoverConfig = {
      enabled: true,
      failureThreshold: 2,
      successThreshold: 3,
      healthCheckInterval: 30,
      healthCheckModel: 'gpt-4.1-mini',
    };

    expect(serializeProviderForm({ ...provider, tokenFailoverConfig })).toMatchObject({
      tokenFailoverConfig,
    });
    expect(validateProviderPayload({
      name: 'openai',
      type: 'openai',
      tokens: ['token-a'],
      tokenFailoverConfig,
    })).toEqual([]);
  });

  it('rejects invalid failover and duplicate exact mapping keys', () => {
    expect(validateProviderForm({
      ...provider,
      modelMappings: [
        { pattern: 'team-chat', targetModel: 'gpt-4.1' },
        { pattern: 'team-chat', targetModel: 'gpt-4.1-mini' },
      ],
      tokenFailoverConfig: {
        enabled: true,
        failureThreshold: 0,
        successThreshold: 0,
        healthCheckInterval: 0,
        healthCheckModel: '',
      },
    })).toHaveLength(5);
  });

  it('serializes route upstream mappings and validates its references', () => {
    const route: RouteForm = {
      name: 'chat',
      pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
      upstreams: [{ provider: 'openai', weight: 100, modelMappings: [{ pattern: '*', targetModel: 'gpt-4.1' }] }],
      modelPredicates: [],
      authConfig: { enabled: true, allowedCredentialTypes: ['key-auth'] },
    };

    expect(validateRouteForm(route, ['openai'])).toEqual([]);
    expect(serializeRouteForm(route).upstreams[0].modelMapping).toEqual({ '*': 'gpt-4.1' });
    expect(validateRouteForm({ ...route, upstreams: [{ ...route.upstreams[0], provider: 'missing' }] }, ['openai']))
      .toContain('上游厂商不存在: missing');
  });

  it('preserves Controller-managed consumers when serializing route edits', () => {
    const route: RouteForm = {
      name: 'agentteams',
      pathPredicate: { matchType: 'PRE', matchValue: '/v1' },
      upstreams: [{ provider: 'openai', weight: 100, modelMappings: [] }],
      modelPredicates: [{ matchType: 'EXACT', matchValue: 'team-chat' }],
      authConfig: {
        enabled: true,
        allowedCredentialTypes: ['key-auth'],
        allowedConsumers: ['manager', 'worker-research'],
      },
    };

    const payload = serializeRouteForm(route);

    expect(payload.authConfig).toEqual({
      enabled: true,
      allowedCredentialTypes: ['key-auth'],
      allowedConsumers: ['manager', 'worker-research'],
    });
    expect(payload.authConfig?.allowedConsumers).not.toBe(route.authConfig.allowedConsumers);
  });

  it('serializes pathPredicate as PRE and EXACT model matches as EQUAL', () => {
    const route: RouteForm = {
      name: 'team-chat',
      pathPredicate: { matchType: 'EXACT', matchValue: '/v1/chat/completions' },
      upstreams: [{ provider: 'openai', weight: 100, modelMappings: [] }],
      modelPredicates: [{ matchType: 'EXACT', matchValue: 'team-chat' }],
      authConfig: { enabled: true, allowedCredentialTypes: ['key-auth'] },
    };

    const payload = serializeRouteForm(route);

    expect(payload.pathPredicate).toEqual({ matchType: 'PRE', matchValue: '/v1/chat/completions' });
    expect(payload.modelPredicates).toEqual([{ matchType: 'EQUAL', matchValue: 'team-chat' }]);
  });

  it('round-trips EXACT through EQUAL restore', () => {
    expect(normalizeMatchTypeForApi('EXACT', 'team-chat')).toEqual({ matchType: 'EQUAL', matchValue: 'team-chat' });
    expect(restoreMatchTypeFromApi('EQUAL', 'team-chat')).toEqual({ matchType: 'EXACT', matchValue: 'team-chat' });
    expect(restoreMatchTypeFromApi('PRE', '/v1')).toEqual({ matchType: 'PRE', matchValue: '/v1' });
  });

  it('leaves hand-written regular expressions untouched', () => {
    expect(restoreMatchTypeFromApi('REGULAR', '^(team-chat|team-code)$')).toEqual({
      matchType: 'REGULAR',
      matchValue: '^(team-chat|team-code)$',
    });
    expect(restoreMatchTypeFromApi('PRE', '/v1')).toEqual({ matchType: 'PRE', matchValue: '/v1' });
  });

  it('validates known fallback fields while preserving unknown fields', () => {
    const parsed = parseFallbackConfig('{"maxRetries":2,"vendorExtension":{"mode":"adaptive"}}');

    expect(parsed.config).toEqual({
      maxRetries: 2,
      vendorExtension: { mode: 'adaptive' },
    });
    expect(summarizeFallbackConfig(parsed.config)).toBe('最大重试 2 次');
    expect(parseFallbackConfig('{"maxRetries":-1}').error).toBe('fallbackConfig.maxRetries 必须是非负整数');
    expect(parseFallbackConfig('[]').error).toBe('回退配置必须是 JSON 对象');
    expect(parseFallbackConfig('{"retryStatusCodes":[429,"500"]}').error).toBe('fallbackConfig.retryStatusCodes 必须是整数数组');
    expect(parseFallbackConfig('{"fallbacks":["provider-a"]}').error).toBe('fallbackConfig.fallbacks 必须是对象数组');
  });

  it('rejects malformed provider and route proxy payloads', () => {
    expect(validateProviderPayload({ name: 'openai', type: 'openai', tokens: [''] })).toContain('tokens 必须是非空字符串数组');
    expect(validateProviderPayload({ name: 'openai', type: 'openai', tokens: ['token'], protocol: 'unsupported' })).toContain('protocol 必须是 openai/v1 或 original');
    expect(validateAiRoutePayload({ name: 'chat', pathPredicate: { matchType: 'PRE', matchValue: '/v1' }, upstreams: [{ provider: 'one', weight: 40 }, { provider: 'two', weight: 40 }] })).toContain('多个上游的权重总和必须为 100');
    expect(validateAiRoutePayload({ name: 'chat', pathPredicate: { matchType: 'PRE', matchValue: '/v1' }, upstreams: [{ provider: 'one', weight: 100 }], fallbackConfig: { maxRetries: -1 } })).toContain('fallbackConfig.maxRetries 必须是非负整数');
    expect(validateAiRoutePayload({ name: 'chat', pathPredicate: { matchType: 'PRE', matchValue: '/v1' }, upstreams: [{ provider: 'one', weight: 100, modelMapping: [] }] })).toContain('上游模型映射必须是对象');
    expect(validateAiRoutePayload({ name: 'chat', pathPredicate: { matchType: 'PRE', matchValue: '/v1' }, upstreams: [{ provider: 'one', weight: 100 }], authConfig: { enabled: true, allowedCredentialTypes: [] } })).toContain('启用路由认证时至少需要一种凭据类型');
    expect(validateAiRoutePayload({ name: 'chat', pathPredicate: { matchType: 'PRE', matchValue: '/v1' }, upstreams: [{ provider: 'one', weight: 100 }], authConfig: { enabled: true, allowedCredentialTypes: ['key-auth'], allowedConsumers: [1] } })).toContain('authConfig 配置无效');
  });
});
