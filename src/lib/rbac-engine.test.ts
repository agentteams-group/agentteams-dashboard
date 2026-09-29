import { describe, expect, it } from 'vitest';
import {
  checkPermission,
  checkPermissionByLevel,
  getAccessSummary,
  type RBACRule,
} from './rbac-engine';
import type { HumanResponse } from '@/lib/agentteams-api';

function makeHuman(overrides: Partial<HumanResponse> = {}): HumanResponse {
  return {
    name: 'carol',
    phase: 'Active',
    displayName: 'Carol',
    matrixUserID: '@carol:server',
    initialPassword: '',
    rooms: [],
    message: '',
    permissionLevel: 2,
    ...overrides,
  };
}

function makeRule(overrides: Partial<RBACRule> = {}): RBACRule {
  return {
    id: 'rule-1',
    subject: { type: 'human', name: 'carol' },
    resource: { type: 'worker', name: 'w1' },
    actions: ['delete'],
    effect: 'deny',
    ...overrides,
  };
}

describe('checkPermissionByLevel (session scale)', () => {
  it('level 1 is view-only', () => {
    expect(checkPermissionByLevel(1, 'view')).toBe(true);
    expect(checkPermissionByLevel(1, 'wake')).toBe(false);
    expect(checkPermissionByLevel(1, 'delete')).toBe(false);
  });

  it('level 2 adds wake/sleep/ensure-ready but not mutations', () => {
    expect(checkPermissionByLevel(2, 'wake')).toBe(true);
    expect(checkPermissionByLevel(2, 'sleep')).toBe(true);
    expect(checkPermissionByLevel(2, 'ensure-ready')).toBe(true);
    expect(checkPermissionByLevel(2, 'create')).toBe(false);
    expect(checkPermissionByLevel(2, 'delete')).toBe(false);
    expect(checkPermissionByLevel(2, 'manage')).toBe(false);
  });

  it('level 3 is admin-grade including manage', () => {
    for (const action of ['view', 'create', 'update', 'delete', 'wake', 'sleep', 'ensure-ready', 'manage'] as const) {
      expect(checkPermissionByLevel(3, action)).toBe(true);
    }
  });

  it('unknown/undefined levels fail closed to view-only', () => {
    expect(checkPermissionByLevel(undefined, 'view')).toBe(true);
    expect(checkPermissionByLevel(undefined, 'delete')).toBe(false);
    expect(checkPermissionByLevel(99, 'delete')).toBe(false);
    expect(checkPermissionByLevel(0, 'delete')).toBe(false);
  });
});

describe('checkPermission (deny overrides allow)', () => {
  it('an explicit deny beats the level default', () => {
    const human = makeHuman({ permissionLevel: 3 }); // level alone would allow
    const rules = [makeRule({ effect: 'deny', actions: ['delete'] })];
    expect(checkPermission(human, 'delete', 'worker', 'w1', rules)).toEqual({
      allowed: false,
      reason: '被规则 "rule-1" 显式拒绝',
    });
  });

  it('an explicit deny beats a later explicit allow (first match wins, deny first in list)', () => {
    const human = makeHuman();
    const rules = [
      makeRule({ id: 'deny-1', effect: 'deny' }),
      makeRule({ id: 'allow-1', effect: 'allow' }),
    ];
    const result = checkPermission(human, 'delete', 'worker', 'w1', rules);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('deny-1');
  });

  it('an explicit allow grants beyond the level default', () => {
    const human = makeHuman({ permissionLevel: 1 }); // view-only by level
    const rules = [makeRule({ effect: 'allow', actions: ['delete'] })];
    expect(checkPermission(human, 'delete', 'worker', 'w1', rules).allowed).toBe(true);
  });

  it('a deny for a different action does not shadow other actions', () => {
    const human = makeHuman({ permissionLevel: 3 });
    const rules = [makeRule({ actions: ['delete'] })];
    expect(checkPermission(human, 'wake', 'worker', 'w1', rules).allowed).toBe(true);
  });

  it('a deny for a different subject does not apply', () => {
    const human = makeHuman({ name: 'bob', permissionLevel: 3 });
    const rules = [makeRule({ subject: { type: 'human', name: 'carol' } })];
    expect(checkPermission(human, 'delete', 'worker', 'w1', rules).allowed).toBe(true);
  });

  it('a role-level deny applies to every human at that session level', () => {
    const human = makeHuman({ permissionLevel: 2 });
    const rules = [makeRule({ subject: { type: 'role', level: 2 }, actions: ['wake'] })];
    const result = checkPermission(human, 'wake', 'worker', 'w1', rules);
    expect(result.allowed).toBe(false);
  });

  it('a role-level deny for another level does not apply', () => {
    const human = makeHuman({ permissionLevel: 2 });
    const rules = [makeRule({ subject: { type: 'role', level: 3 }, actions: ['wake'] })];
    expect(checkPermission(human, 'wake', 'worker', 'w1', rules).allowed).toBe(true);
  });
});

describe('checkPermission (resource matching)', () => {
  it('global rules match any resource type', () => {
    const human = makeHuman({ permissionLevel: 1 });
    const rules = [makeRule({ resource: { type: 'global' }, effect: 'allow', actions: ['manage'] })];
    expect(checkPermission(human, 'manage', 'team', 't1', rules).allowed).toBe(true);
  });

  it('worker rules do not match team resources', () => {
    const human = makeHuman({ permissionLevel: 1 });
    const rules = [makeRule({ resource: { type: 'worker', name: 'w1' }, effect: 'allow', actions: ['delete'] })];
    expect(checkPermission(human, 'delete', 'team', 'w1', rules).allowed).toBe(false);
  });

  it('a rule without a resource name applies to every instance of the type', () => {
    const human = makeHuman({ permissionLevel: 1 });
    const rules = [makeRule({ resource: { type: 'worker' }, effect: 'allow', actions: ['delete'] })];
    expect(checkPermission(human, 'delete', 'worker', 'any-worker', rules).allowed).toBe(true);
  });

  it('a rule with a different resource name does not apply', () => {
    const human = makeHuman({ permissionLevel: 1 });
    const rules = [makeRule({ resource: { type: 'worker', name: 'w2' }, effect: 'allow', actions: ['delete'] })];
    expect(checkPermission(human, 'delete', 'worker', 'w1', rules).allowed).toBe(false);
  });
});

describe('checkPermission (scoping fallback)', () => {
  it('level grants the action but the team is out of scope', () => {
    const human = makeHuman({ permissionLevel: 3, accessibleTeams: ['t1'] });
    const result = checkPermission(human, 'delete', 'team', 't2', []);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('t2');
  });

  it('level grants the action and the team is in scope', () => {
    const human = makeHuman({ permissionLevel: 3, accessibleTeams: ['t1', 't2'] });
    expect(checkPermission(human, 'delete', 'team', 't2', []).allowed).toBe(true);
  });

  it('worker scoping blocks out-of-scope workers', () => {
    const human = makeHuman({ permissionLevel: 3, accessibleWorkers: ['w1'] });
    const result = checkPermission(human, 'wake', 'worker', 'w9', []);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('w9');
  });

  it('an empty scoping list means unrestricted', () => {
    const human = makeHuman({ permissionLevel: 3, accessibleWorkers: [], accessibleTeams: [] });
    expect(checkPermission(human, 'delete', 'worker', 'w9', []).allowed).toBe(true);
    expect(checkPermission(human, 'delete', 'team', 't9', []).allowed).toBe(true);
  });

  it('level without the action fails before scoping is consulted', () => {
    const human = makeHuman({ permissionLevel: 1, accessibleWorkers: ['w1'] });
    const result = checkPermission(human, 'delete', 'worker', 'w1', []);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('权限等级');
  });
});

describe('getAccessSummary', () => {
  it('maps session levels to labels and permission sets', () => {
    expect(getAccessSummary(makeHuman({ permissionLevel: 1 })).level).toBe('观察者');
    expect(getAccessSummary(makeHuman({ permissionLevel: 2 })).level).toBe('操作者');
    expect(getAccessSummary(makeHuman({ permissionLevel: 3 })).level).toBe('管理员');
    expect(getAccessSummary(makeHuman({ permissionLevel: 2 })).permissions).toContain('ensure-ready');
  });

  it('defaults to level 1 and unrestricted scopes', () => {
    const summary = getAccessSummary(makeHuman({ permissionLevel: undefined }));
    expect(summary.levelNumber).toBe(1);
    expect(summary.teamScope).toBe('所有团队');
    expect(summary.workerScope).toBe('所有 Worker');
  });

  it('joins scoped teams and workers', () => {
    const summary = getAccessSummary(
      makeHuman({ accessibleTeams: ['t1', 't2'], accessibleWorkers: ['w1'] }),
    );
    expect(summary.teamScope).toBe('t1, t2');
    expect(summary.workerScope).toBe('w1');
  });
});
