// RBAC Engine — Role-Based Access Control
// Evaluates permissions for Human users against Workers/Teams

import type { HumanResponse } from '@/lib/agentteams-api';

export type Permission = 'view' | 'create' | 'update' | 'delete' | 'wake' | 'sleep' | 'ensure-ready' | 'manage';

export interface RBACRule {
  id: string;
  subject: { type: 'human'; name: string } | { type: 'role'; level: number };
  resource: { type: 'worker' | 'team' | 'global'; name?: string };
  actions: Permission[];
  effect: 'allow' | 'deny';
}

// Dashboard SESSION levels (NOT the controller CR permissionLevel — login
// maps CR → session via MATRIX_CR_LEVEL_TO_DASH_LEVEL {1:3, 2:2, 3:1}).
// Session scale: 1 = least (view only), 2 = wake/sleep, 3 = admin-grade
// (all actions). server-auth builds a HumanResponse whose permissionLevel
// is the session level, so this table is consulted on that scale.
//
// The controller CR scale is the reverse (1 = 管理员 > 2 = 团队成员 >
// 3 = Worker, docs/usage/import-worker.md) — that scale only appears in
// the Human management UI (human-types.ts labels), never here.
const LEVEL_PERMISSIONS: Record<number, Permission[]> = {
  1: ['view'],
  2: ['view', 'wake', 'sleep', 'ensure-ready'],
  // 'manage' marks host/admin-adjacent operations (Docker container logs,
  // storage maintenance, ...) that only an admin-grade session may perform.
  3: ['view', 'create', 'update', 'delete', 'wake', 'sleep', 'ensure-ready', 'manage'],
};

function getLevelPermissions(level: number | undefined): Permission[] {
  return LEVEL_PERMISSIONS[level ?? 1] ?? LEVEL_PERMISSIONS[1];
}

/**
 * Check whether a permission level grants the action. Pure level-based
 * decision (no resource scoping) — applies to global resources such as
 * storage buckets, skill catalogs, project boards, and gateway routes
 * that are not partitioned per-team/per-worker.
 */
export function checkPermissionByLevel(level: number | undefined, action: Permission): boolean {
  return getLevelPermissions(level).includes(action);
}

/**
 * Check if a human has a specific permission on a resource.
 * Rules:
 * 1. Check explicit RBAC rules first (deny overrides allow)
 * 2. Fall back to permission level defaults
 * 3. Check accessibleTeams/accessibleWorkers scoping
 */
export function checkPermission(
  human: HumanResponse,
  action: Permission,
  resourceType: 'worker' | 'team',
  resourceName: string,
  customRules: RBACRule[] = []
): { allowed: boolean; reason: string } {
  // Check explicit deny rules first so they cannot be bypassed by scope defaults.
  for (const rule of customRules) {
    const subjectMatches =
      (rule.subject.type === 'human' && rule.subject.name === human.name) ||
      (rule.subject.type === 'role' && rule.subject.level === human.permissionLevel);
    const resourceMatches =
      rule.resource.type === 'global' ||
      (rule.resource.type === resourceType && (!rule.resource.name || rule.resource.name === resourceName));
    if (subjectMatches && resourceMatches && rule.actions.includes(action) && rule.effect === 'deny') {
      return { allowed: false, reason: `被规则 "${rule.id}" 显式拒绝` };
    }
  }

  // 只有可信管理员身份代表全局范围。缺失或空列表均表示无范围，必须拒绝；
  // 显式 allow 规则也不能绕过这一边界。
  const globalScope = human.systemAdmin === true;
  const scopedNames = resourceType === 'team' ? human.accessibleTeams : human.accessibleWorkers;
  if (!globalScope) {
    if (!Array.isArray(scopedNames)) {
      return { allowed: false, reason: `未知${resourceType === 'team' ? '团队' : 'Worker'}范围，默认拒绝` };
    }
    if (!scopedNames.includes(resourceName)) {
      return {
        allowed: false,
        reason: `用户无权访问${resourceType === 'team' ? '团队' : 'Worker'} "${resourceName}"`,
      };
    }
  }

  // Check explicit allow rules after the resource boundary has been enforced.
  for (const rule of customRules) {
    const subjectMatches =
      (rule.subject.type === 'human' && rule.subject.name === human.name) ||
      (rule.subject.type === 'role' && rule.subject.level === human.permissionLevel);
    const resourceMatches =
      rule.resource.type === 'global' ||
      (rule.resource.type === resourceType && (!rule.resource.name || rule.resource.name === resourceName));
    if (subjectMatches && resourceMatches && rule.actions.includes(action) && rule.effect === 'allow') {
      return { allowed: true, reason: `被规则 "${rule.id}" 显式允许` };
    }
  }

  // Fall back to permission level.
  const levelPerms = getLevelPermissions(human.permissionLevel);
  if (!levelPerms.includes(action)) {
    return {
      allowed: false,
      reason: `权限等级 ${human.permissionLevel ?? 1} 不允许 "${action}" 操作`,
    };
  }

  return { allowed: true, reason: globalScope ? '通过管理员全局范围检查' : '通过权限等级与资源范围检查' };
}

/**
 * Get a summary of a human's access scope.
 */
export function getAccessSummary(human: HumanResponse): {
  level: string;
  levelNumber: number;
  permissions: Permission[];
  teamScope: string;
  workerScope: string;
} {
  // Session-scale names (see LEVEL_PERMISSIONS header): 3 = 管理员级.
  const levelNames: Record<number, string> = {
    1: '观察者',
    2: '操作者',
    3: '管理员',
  };

  const level = human.permissionLevel ?? 1;
  return {
    level: levelNames[level] || '未知',
    levelNumber: level,
    permissions: getLevelPermissions(level),
    teamScope: human.systemAdmin === true
      ? '所有团队'
      : Array.isArray(human.accessibleTeams) && human.accessibleTeams.length > 0
        ? human.accessibleTeams.join(', ')
        : '无团队范围',
    workerScope: human.systemAdmin === true
      ? '所有 Worker'
      : Array.isArray(human.accessibleWorkers) && human.accessibleWorkers.length > 0
        ? human.accessibleWorkers.join(', ')
        : '无 Worker 范围',
  };
}
