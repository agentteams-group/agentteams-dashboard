import { describe, expect, it } from 'vitest';
import { BUILTIN_MODEL_ALIASES, buildModelSelectionOptions, describeRouteAuthorization } from './model-catalog';

const providers = [{ name: 'openai', type: 'openai', protocol: 'openai/v1', tokenCount: 1 }];
const routes = [{
  name: 'team-chat',
  pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
  upstreams: [{ provider: 'openai', weight: 100, modelMapping: { 'team-chat': 'gpt-4.1' } }],
  modelPredicates: [{ matchType: 'EXACT', matchValue: 'team-chat' }],
  authConfig: { enabled: true, allowedCredentialTypes: ['key-auth'] },
  fallbackConfigWritable: true,
}];

describe('model-catalog', () => {
  it('mirrors the official built-in model alias list', () => {
    expect(BUILTIN_MODEL_ALIASES).toContain('deepseek-chat');
    expect(BUILTIN_MODEL_ALIASES).toContain('claude-sonnet-4-6');
    expect(BUILTIN_MODEL_ALIASES).toContain('qwen3.5-plus');
    expect(BUILTIN_MODEL_ALIASES.length).toBe(16);
  });

  it('combines configured aliases with builtin aliases', () => {
    const options = buildModelSelectionOptions(routes, providers);

    const configured = options.find((option) => option.alias === 'team-chat');
    expect(configured?.kind).toBe('configured');
    expect(configured?.binding?.providerName).toBe('openai');

    const builtin = options.find((option) => option.alias === 'deepseek-chat');
    expect(builtin?.kind).toBe('builtin');

    const duplicates = options.length !== new Set(options.map((option) => option.alias)).size;
    expect(duplicates).toBe(false);
  });

  it('adds a SGLang serving layer without disturbing the alias layer', () => {
    const options = buildModelSelectionOptions(routes, providers, [
      'qwen3.6-27b-fp8',
      'local-llama-70b',
    ]);

    expect(options.find((option) => option.alias === 'qwen3.6-27b-fp8')?.kind).toBe('sglang');
    expect(options.find((option) => option.alias === 'local-llama-70b')?.kind).toBe('sglang');
    // Alias layer untouched.
    expect(options.find((option) => option.alias === 'team-chat')?.kind).toBe('configured');
    expect(options.find((option) => option.alias === 'deepseek-chat')?.kind).toBe('builtin');
  });

  it('keeps the alias layer on SGLang name collision (configured and builtin win)', () => {
    const options = buildModelSelectionOptions(routes, providers, [
      'team-chat', // collides with a configured alias
      'deepseek-chat', // collides with a builtin alias
      'qwen3.6-27b-fp8',
    ]);

    expect(options.filter((option) => option.alias === 'team-chat')).toHaveLength(1);
    expect(options.find((option) => option.alias === 'team-chat')?.kind).toBe('configured');
    expect(options.find((option) => option.alias === 'deepseek-chat')?.kind).toBe('builtin');
    expect(options.find((option) => option.alias === 'qwen3.6-27b-fp8')?.kind).toBe('sglang');
  });

  it('dedupes and filters empty SGLang ids', () => {
    const options = buildModelSelectionOptions([], [], ['dup-model', 'dup-model', '', 'solo-model']);

    expect(options.filter((option) => option.alias === 'dup-model')).toHaveLength(1);
    expect(options.find((option) => option.alias === 'solo-model')?.kind).toBe('sglang');
    expect(options.some((option) => option.alias === '')).toBe(false);
  });
});

describe('model-catalog route authorization (#133)', () => {
  it('carries the resolving route auth summary onto configured options', () => {
    const options = buildModelSelectionOptions(
      [{ ...routes[0], authConfig: { enabled: true, allowedCredentialTypes: ['key-auth'], allowedConsumers: ['worker-alpha', 'manager'] } }],
      providers,
    );

    const option = options.find((item) => item.alias === 'team-chat');
    expect(option?.routeAuth).toEqual({ enabled: true, allowedConsumers: ['worker-alpha', 'manager'] });
  });

  it('marks auth-disabled routes as unrestricted', () => {
    const options = buildModelSelectionOptions(
      [{ ...routes[0], authConfig: { enabled: false, allowedCredentialTypes: [] } }],
      providers,
    );

    expect(options.find((item) => item.alias === 'team-chat')?.routeAuth).toEqual({
      enabled: false,
      allowedConsumers: [],
    });
  });

  it('leaves routeAuth undefined for builtin and sglang options', () => {
    const options = buildModelSelectionOptions(routes, providers, ['qwen-local']);

    expect(options.find((item) => item.alias === 'deepseek-chat')?.routeAuth).toBeUndefined();
    expect(options.find((item) => item.alias === 'qwen-local')?.routeAuth).toBeUndefined();
  });
});

describe('describeRouteAuthorization', () => {
  it('returns null when the route is unknown', () => {
    expect(describeRouteAuthorization(undefined)).toBeNull();
  });

  it('describes unrestricted, unbounded and bounded auth in order', () => {
    expect(describeRouteAuthorization({ enabled: false, allowedConsumers: [] }))
      .toBe('路由未启用认证（无 Consumer 限制）');
    expect(describeRouteAuthorization({ enabled: true, allowedConsumers: [] }))
      .toBe('已启用认证，未限定 Consumer');
    expect(describeRouteAuthorization({ enabled: true, allowedConsumers: ['worker-a', 'worker-b'] }))
      .toBe('授权 Consumer：worker-a、worker-b');
  });
});
