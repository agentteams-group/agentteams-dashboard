import { describe, expect, it } from 'vitest';
import { BUILTIN_MODEL_ALIASES, buildModelSelectionOptions } from './model-catalog';

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
});
