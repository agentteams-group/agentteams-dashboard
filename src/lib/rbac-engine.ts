// RBAC Engine — Role-Based Access Control
// Evaluates permissions for Human users against Workers/Teams

import type { HumanResponse } from '@/lib/agentteams-api';

export type Permission = 'view' | 'create' | 'update' | 'delete' | 'wake' | 'sleep' | 'ensure-ready';

export interface RBACRule {
  id: string;
  subject: { type: 'human'; name: string } | { type: 'role'; level: number };
  resource: { type: 'worker' | 'team' | 'global'; name?: string };
  actions: Permission[];
  effect: 'allow' | 'deny';
}

// Permission levels from HumanResponse
// 1 = Observer (view only)
// 2 = Operator (view + wake/sleep)
// 3 = Admin (all actions)

const LEVEL_PERMISSIONS: Record<number, Permission[]> = {
  1: ['view'],
  2: ['view', 'wake', 'sleep', 'ensure-ready'],
  3: ['view', 'create', 'update', 'delete', 'wake', 'sleep', 'ensure-ready'],
};

function getLevelPermissions(level: number | undefined): Permission[] {
  return LEVEL_PERMISSIONS[level ?? 1] ?? LEVEL_PERMISSIONS[1];
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
  // Check explicit rules
  for (const rule of customRules) {
    // Check if rule applies to this human
    const subjectMatches =
      (rule.subject.type === 'human' && rule.subject.name === human.name) ||
      (rule.subject.type === 'role' && rule.subject.level === human.permissionLevel);

    if (!subjectMatches) continue;

    // Check if rule applies to this resource
    const resourceMatches =
      rule.resource.type === 'global' ||
      (rule.resource.type === resourceType && (!rule.resource.name || rule.resource.name === resourceName));

    if (!resourceMatches) continue;

    // Check if rule covers this action
    if (!rule.actions.includes(action)) continue;

    if (rule.effect === 'deny') {
      return { allowed: false, reason: `被规则 "${rule.id}" 显式拒绝` };
    }
    if (rule.effect === 'allow') {
      return { allowed: true, reason: `被规则 "${rule.id}" 显式允许` };
    }
  }

  // Fall back to permission level
  const levelPerms = getLevelPermissions(human.permissionLevel);
  if (!levelPerms.includes(action)) {
    return {
      allowed: false,
      reason: `权限等级 ${human.permissionLevel ?? 1} 不允许 "${action}" 操作`,
    };
  }

  // Check resource scoping (accessibleTeams/accessibleWorkers)
  if (resourceType === 'team' && human.accessibleTeams && human.accessibleTeams.length > 0) {
    if (!human.accessibleTeams.includes(resourceName)) {
      return { allowed: false, reason: `用户无权访问团队 "${resourceName}"` };
    }
  }

  if (resourceType === 'worker' && human.accessibleWorkers && human.accessibleWorkers.length > 0) {
    if (!human.accessibleWorkers.includes(resourceName)) {
      return { allowed: false, reason: `用户无权访问 Worker "${resourceName}"` };
    }
  }

  return { allowed: true, reason: '通过权限等级检查' };
}

/**
 * Get all permissions a human has on a specific resource.
 */
export function getEffectivePermissions(
  human: HumanResponse,
  resourceType: 'worker' | 'team',
  resourceName: string,
  customRules: RBACRule[] = []
): Permission[] {
  const allPerms: Permission[] = ['view', 'create', 'update', 'delete', 'wake', 'sleep', 'ensure-ready'];
  return allPerms.filter((perm) => checkPermission(human, perm, resourceType, resourceName, customRules).allowed);
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
    teamScope: human.accessibleTeams && human.accessibleTeams.length > 0
      ? human.accessibleTeams.join(', ')
      : '所有团队',
    workerScope: human.accessibleWorkers && human.accessibleWorkers.length > 0
      ? human.accessibleWorkers.join(', ')
      : '所有 Worker',
  };
}
