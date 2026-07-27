import { describe, expect, it } from 'vitest';
import {
  serializeProviderForm,
  serializeRouteForm,
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

  it('validates known fallback fields while preserving unknown fields', () => {
    const parsed = parseFallbackConfig('{"maxRetries":2,"vendorExtension":{"mode":"adaptive"}}');

    expect(parsed.config).toEqual({
      maxRetries: 2,
      vendorExtension: { mode: 'adaptive' },
    });
    expect(summarizeFallbackConfig(parsed.config)).toBe('最大重试 2 次');
    expect(parseFallbackConfig('{"maxRetries":-1}').error).toBe('fallbackConfig.maxRetries 必须是非负整数');
    expect(parseFallbackConfig('[]').error).toBe('回退配置必须是 JSON 对象');
  });

  it('rejects malformed provider and route proxy payloads', () => {
    expect(validateProviderPayload({ name: 'openai', type: 'openai', tokens: [''] })).toContain('tokens 必须是非空字符串数组');
    expect(validateProviderPayload({ name: 'openai', type: 'openai', tokens: ['token'], protocol: 'unsupported' })).toContain('protocol 必须是 openai/v1 或 original');
    expect(validateAiRoutePayload({ name: 'chat', pathPredicate: { matchType: 'PRE', matchValue: '/v1' }, upstreams: [{ provider: 'one', weight: 40 }, { provider: 'two', weight: 40 }] })).toContain('多个上游的权重总和必须为 100');
    expect(validateAiRoutePayload({ name: 'chat', pathPredicate: { matchType: 'PRE', matchValue: '/v1' }, upstreams: [{ provider: 'one', weight: 100 }], fallbackConfig: { maxRetries: -1 } })).toContain('fallbackConfig.maxRetries 必须是非负整数');
  });
});
