import { describe, expect, it } from 'vitest';
import {
  allSurfacesLocked,
  buildModelAccessPayload,
  capabilitiesFromHumanRecord,
  draftFromHumanRecord,
  emptyScope,
  findPairIssues,
  isCompletePair,
  serializeScope,
} from './model-access';

describe('model-access', () => {
  it('treats (provider, model) as an atomic pair', () => {
    expect(isCompletePair({ provider: 'p', model: 'm' })).toBe(true);
    expect(isCompletePair({ provider: 'p', model: '' })).toBe(false);
    expect(isCompletePair({ provider: '', model: 'm' })).toBe(false);
    expect(isCompletePair(null)).toBe(false);
  });

  it('serializes main/spawn/codingCli into the wire shape', () => {
    const scope = emptyScope();
    scope.main = [{ provider: 'higress', model: 'gpt-5' }];
    scope.spawn = { entries: [{ provider: 'higress', model: 'gpt-5-mini' }] };
    scope.codingCli = [{ cli: 'qwen-code', inherit: true, entries: [] }];
    expect(serializeScope(scope)).toEqual({
      main: { entries: [{ provider: 'higress', model: 'gpt-5' }] },
      spawn: { entries: [{ provider: 'higress', model: 'gpt-5-mini' }] },
      codingCli: [{ cli: 'qwen-code', inherit: true }],
    });
  });

  it('lets a shared table replace inline surfaces', () => {
    const scope = emptyScope();
    scope.table = 'shared-grants';
    scope.main = [{ provider: 'p', model: 'm' }];
    expect(serializeScope(scope)).toEqual({ table: 'shared-grants' });
  });

  it('returns null for an empty draft and filters incomplete pairs', () => {
    expect(buildModelAccessPayload({ scopes: [emptyScope()] })).toBeNull();
    const scope = emptyScope();
    scope.main = [
      { provider: 'p', model: 'm' },
      { provider: 'p2', model: '' },
    ];
    expect(findPairIssues({ scopes: [scope] })).toEqual([
      { scope: 0, surface: 'main', index: 1 },
    ]);
    expect(buildModelAccessPayload({ scopes: [scope] })).toEqual({
      scopes: [{ main: { entries: [{ provider: 'p', model: 'm' }] } }],
    });
  });

  it('normalizes the array codingCli shape on read', () => {
    const draft = draftFromHumanRecord({
      modelAccess: {
        scopes: [
          {
            role: 'worker',
            codingCli: [{ cli: 'qoder', inherit: true }],
          },
        ],
      },
    });
    expect(draft.scopes).toHaveLength(1);
    expect(draft.scopes[0].role).toBe('worker');
    expect(draft.scopes[0].codingCli).toEqual([{ cli: 'qoder', entries: [], inherit: true }]);
  });

  it('detects all-locked capabilities', () => {
    expect(
      allSurfacesLocked({
        main: { canEdit: false },
        spawn: { canEdit: false },
        codingCli: { 'qwen-code': { canEdit: false } },
      }),
    ).toBe(true);
    expect(allSurfacesLocked({ main: { canEdit: false }, spawn: { canEdit: true } })).toBe(false);
    expect(capabilitiesFromHumanRecord({ modelAccess: { capabilities: { main: { canEdit: false } } } })).toEqual({
      main: { canEdit: false },
    });
  });
});
