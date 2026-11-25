import { describe, expect, it } from 'vitest';
import {
  MAX_PATHS_PER_RULE,
  MAX_RULES_PER_LIST,
  buildWorkspaceAccessPayload,
  extractWorkspaceAccess,
  validateAccess,
  validateAccessPath,
  workspaceAccessEqual,
} from './workspace-access';

describe('workspace-access', () => {
  it('accepts files/ paths and globs, rejects everything outside', () => {
    expect(validateAccessPath('files/reports/a.md')).toBeNull();
    expect(validateAccessPath('files/*/a.md')).toBeNull();
    expect(validateAccessPath('files/**')).toBeNull();
    expect(validateAccessPath('files/reports/.trash/x')).toBeNull();
    expect(validateAccessPath('reports/a.md')).toBe('not_files');
    expect(validateAccessPath('/files/a.md')).toBe('absolute');
    expect(validateAccessPath('files/a/')).toBe('trailing_slash');
    expect(validateAccessPath('files/a/../b')).toBe('dot_segment');
    expect(validateAccessPath('files/a//b')).toBe('empty_segment');
    expect(validateAccessPath('files/.trash')).toBe('reserved');
    expect(validateAccessPath('')).toBe('empty');
  });

  it('enforces per-rule path limits and list-level rule limits', () => {
    const paths = Array.from({ length: MAX_PATHS_PER_RULE + 1 }, (_, i) => `files/p${i}`);
    const tooManyPaths = validateAccess({ grants: [{ team: 't', paths, mode: 'read' }] }, null);
    expect(tooManyPaths.some((issue) => issue.kind === 'too_many_paths')).toBe(true);

    const rules = Array.from({ length: MAX_RULES_PER_LIST + 1 }, (_, i) => ({
      team: `t${i}`,
      paths: ['files/a'],
      mode: 'read' as const,
    }));
    const tooManyRules = validateAccess({ grants: rules }, null);
    expect(tooManyRules.some((issue) => issue.kind === 'too_many_rules')).toBe(true);
  });

  it('reports duplicates, unknown teams, empty paths and bad modes', () => {
    const issues = validateAccess(
      {
        grants: [
          { team: 'a', paths: ['files/x'], mode: 'read' },
          { team: 'a', paths: [], mode: 'read' },
          { team: 'b', paths: ['files/y'], mode: 'none' },
          { team: '', paths: ['files/z'], mode: 'read' },
        ],
      },
      ['a'],
    );
    expect(issues.some((issue) => issue.kind === 'dup_team')).toBe(true);
    expect(issues.some((issue) => issue.kind === 'no_paths')).toBe(true);
    expect(issues.some((issue) => issue.kind === 'bad_mode')).toBe(true);
    expect(issues.some((issue) => issue.kind === 'unknown_team')).toBe(true);
    expect(issues.some((issue) => issue.kind === 'empty_team')).toBe(true);
  });

  it('builds a wire payload and clears with an empty object', () => {
    expect(buildWorkspaceAccessPayload({ grants: [], restrictions: [] })).toEqual({});
    expect(
      buildWorkspaceAccessPayload({
        grants: [{ team: ' team-a ', paths: ['files/a'], mode: 'readwrite' }],
        restrictions: [{ team: 'team-b', paths: ['files/secret'], mode: 'none' }],
      }),
    ).toEqual({
      grants: [{ team: 'team-a', paths: ['files/a'], mode: 'readwrite' }],
      restrictions: [{ team: 'team-b', paths: ['files/secret'], mode: 'none' }],
    });
  });

  it('extracts both flat and spec-shaped records and compares order-insensitively', () => {
    const rules = [{ team: 'team-a', paths: ['files/b', 'files/a'], mode: 'read' as const }];
    expect(extractWorkspaceAccess({ workspaceAccess: { grants: rules } })).toEqual({
      grants: rules,
    });
    expect(extractWorkspaceAccess({ spec: { workspaceAccess: { grants: rules } } })).toEqual({
      grants: rules,
    });
    expect(
      workspaceAccessEqual(
        { grants: rules },
        { grants: [{ team: 'team-a', paths: ['files/a', 'files/b'], mode: 'read' }] },
      ),
    ).toBe(true);
    expect(workspaceAccessEqual(null, { grants: [] })).toBe(true);
  });
});
