import { describe, expect, it } from 'vitest';
import { maskProvider } from './helpers';

describe('Higress provider credential masking', () => {
  it('removes both UI tokens and raw Console apiTokens while preserving editable metadata', () => {
    const provider = { name: 'test', tokens: ['primary-secret'], rawConfigs: { apiTokens: ['raw-secret'], apiUrl: 'https://provider.example/v1' } };
    const result = maskProvider(provider);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result).toEqual({ name: 'test', tokenCount: 1, rawConfigs: { apiUrl: 'https://provider.example/v1' } });
    expect(provider.rawConfigs.apiTokens).toEqual(['raw-secret']);
  });
  it('preserves token counts already masked by Controller', () => {
    expect(maskProvider({ name: 'test', tokenCount: 2 })).toEqual({ name: 'test', tokenCount: 2 });
  });
});
