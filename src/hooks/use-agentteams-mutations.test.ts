import { describe, expect, it } from 'vitest';
import { maskApiKey } from './use-agentteams-mutations';

describe('maskApiKey', () => {
  it('fully masks keys that are too short to reveal', () => {
    expect(maskApiKey('abc')).toBe('••••••••');
    expect(maskApiKey('12345678')).toBe('••••••••');
  });

  it('reveals only the first and last four characters', () => {
    expect(maskApiKey('sk-0123456789abcdef')).toBe('sk-0••••cdef');
    expect(maskApiKey('12345678901234567890')).toBe('1234••••7890');
  });
});
