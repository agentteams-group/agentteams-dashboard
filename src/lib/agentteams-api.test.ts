import { describe, it, expect } from 'vitest';
import { normalizeKubeMode } from '@/lib/agentteams-api';

describe('normalizeKubeMode', () => {
  it('passes booleans through', () => {
    expect(normalizeKubeMode(true)).toBe(true);
    expect(normalizeKubeMode(false)).toBe(false);
  });

  it('treats v1.2.0 string values correctly', () => {
    expect(normalizeKubeMode('incluster')).toBe(true);
    expect(normalizeKubeMode('k8s')).toBe(true);
    expect(normalizeKubeMode('embedded')).toBe(false);
  });

  it('treats unknown or missing values as not k8s', () => {
    expect(normalizeKubeMode(undefined)).toBe(false);
    expect(normalizeKubeMode(null)).toBe(false);
    expect(normalizeKubeMode('')).toBe(false);
    expect(normalizeKubeMode('something-else')).toBe(false);
  });
});
