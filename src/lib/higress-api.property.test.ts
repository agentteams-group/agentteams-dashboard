import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateAiRoutePayload, validateModelMappings } from './higress-api';

const nonBlankString = fc.string({ minLength: 1, maxLength: 24 }).filter((value) => value.trim().length > 0);
const exactMappingKey = nonBlankString.filter((value) => !value.includes('*') && !value.startsWith('~'));

describe('Higress validation properties', () => {
  it('rejects every duplicate exact model mapping key', () => {
    fc.assert(fc.property(exactMappingKey, nonBlankString, (pattern, firstTarget) => {
      const errors = validateModelMappings([
        { pattern, targetModel: firstTarget },
        { pattern, targetModel: 'replacement-model' },
      ]);

      expect(errors).toContain(`模型映射包含重复精确键: ${pattern.trim()}`);
    }), { numRuns: 100 });
  });

  it('accepts every valid two-upstream weight partition and rejects other sums', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 100 }), (weight) => {
      const errors = validateAiRoutePayload({
        name: 'team-chat',
        pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
        upstreams: [
          { provider: 'primary', weight },
          { provider: 'secondary', weight: 100 - weight },
        ],
      });

      expect(errors).not.toContain('多个上游的权重总和必须为 100');
    }), { numRuns: 100 });

    fc.assert(fc.property(
      fc.integer({ min: 0, max: 100 }),
      fc.integer({ min: 0, max: 100 }),
      (firstWeight, secondWeight) => {
        fc.pre(firstWeight + secondWeight !== 100);
        const errors = validateAiRoutePayload({
          name: 'team-chat',
          pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
          upstreams: [
            { provider: 'primary', weight: firstWeight },
            { provider: 'secondary', weight: secondWeight },
          ],
        });

        expect(errors).toContain('多个上游的权重总和必须为 100');
      },
    ), { numRuns: 100 });
  });

  it('requires credentials whenever route authentication is enabled', () => {
    fc.assert(fc.property(fc.array(nonBlankString, { minLength: 1, maxLength: 4 }), (credentialTypes) => {
      const errors = validateAiRoutePayload({
        name: 'team-chat',
        pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
        upstreams: [{ provider: 'primary', weight: 100 }],
        authConfig: { enabled: true, allowedCredentialTypes: credentialTypes },
      });

      expect(errors).not.toContain('启用路由认证时至少需要一种凭据类型');
    }), { numRuns: 100 });

    expect(validateAiRoutePayload({
      name: 'team-chat',
      pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
      upstreams: [{ provider: 'primary', weight: 100 }],
      authConfig: { enabled: true, allowedCredentialTypes: [] },
    })).toContain('启用路由认证时至少需要一种凭据类型');
  });
});
