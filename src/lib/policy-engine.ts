// Policy Engine — Declarative Governance Rules
// Evaluates policies against current entity state and returns violations

import type { WorkerResponse, TeamResponse, ManagerResponse, HumanResponse } from '@/lib/hiclaw-api';

export interface Policy {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  scope: 'global' | { type: 'worker' | 'team' | 'manager' | 'human'; name?: string };
  rules: PolicyRule[];
  enforcement: 'warn' | 'block' | 'auto-remediate';
  createdAt: number;
  updatedAt: number;
}

export interface PolicyRule {
  field: string;
  operator: 'eq' | 'neq' | 'in' | 'not_in' | 'contains' | 'gt' | 'lt' | 'empty' | 'not_empty';
  value: unknown;
}

export interface PolicyViolation {
  policyId: string;
  policyName: string;
  enforcement: Policy['enforcement'];
  entityType: string;
  entityName: string;
  rule: PolicyRule;
  actualValue: unknown;
  message: string;
}

// ============ Built-in Policies ============

export const BUILTIN_POLICIES: Policy[] = [
  {
    id: 'no-failed-workers',
    name: '禁止失败状态 Worker',
    description: '所有 Worker 不应处于 Failed 状态',
    enabled: true,
    scope: 'global',
    rules: [{ field: 'phase', operator: 'neq', value: 'Failed' }],
    enforcement: 'warn',
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'workers-need-model',
    name: 'Worker 必须配置模型',
    description: '所有运行中的 Worker 必须配置模型',
    enabled: true,
    scope: 'global',
    rules: [
      { field: 'phase', operator: 'in', value: ['Running', 'Ready'] },
      { field: 'model', operator: 'not_empty', value: null },
    ],
    enforcement: 'warn',
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'workers-need-team',
    name: 'Worker 应分配团队',
    description: '所有 Worker 应该属于一个团队',
    enabled: true,
    scope: 'global',
    rules: [{ field: 'team', operator: 'not_empty', value: null }],
    enforcement: 'warn',
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'no-failed-teams',
    name: '禁止失败状态团队',
    description: '所有团队不应处于 Failed 状态',
    enabled: true,
    scope: 'global',
    rules: [{ field: 'phase', operator: 'neq', value: 'Failed' }],
    enforcement: 'warn',
    createdAt: 0,
    updatedAt: 0,
  },
];

// ============ Rule Evaluation ============

function evaluateRule(rule: PolicyRule, entity: Record<string, unknown>): boolean {
  const actual = entity[rule.field];

  switch (rule.operator) {
    case 'eq':
      return actual === rule.value;
    case 'neq':
      return actual !== rule.value;
    case 'in':
      return Array.isArray(rule.value) && rule.value.includes(actual);
    case 'not_in':
      return Array.isArray(rule.value) && !rule.value.includes(actual);
    case 'contains':
      return typeof actual === 'string' && typeof rule.value === 'string' && actual.includes(rule.value);
    case 'gt':
      return typeof actual === 'number' && typeof rule.value === 'number' && actual > rule.value;
    case 'lt':
      return typeof actual === 'number' && typeof rule.value === 'number' && actual < rule.value;
    case 'empty':
      return !actual || actual === '' || (Array.isArray(actual) && actual.length === 0);
    case 'not_empty':
      return !!actual && actual !== '' && !(Array.isArray(actual) && actual.length === 0);
    default:
      return true;
  }
}

function evaluateRules(rules: PolicyRule[], entity: Record<string, unknown>): boolean {
  // ALL rules must pass (AND logic)
  return rules.every((rule) => evaluateRule(rule, entity));
}

// ============ Policy Evaluation ============

export function evaluatePolicies(
  policies: Policy[],
  entities: {
    workers: WorkerResponse[];
    teams: TeamResponse[];
    managers: ManagerResponse[];
    humans: HumanResponse[];
  }
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];

  for (const policy of policies) {
    if (!policy.enabled) continue;

    const checkEntity = (
      entityType: string,
      entityName: string,
      entity: Record<string, unknown>
    ) => {
      // Check scope
      if (!isGlobal) {
        const scope = policy.scope as { type: string; name?: string };
        if (scope.type !== entityType) return;
        if (scope.name && scope.name !== entityName) return;
      }

      if (!evaluateRules(policy.rules, entity)) {
        // Find which rule failed for the message
        const failedRule = policy.rules.find((r) => !evaluateRule(r, entity));
        violations.push({
          policyId: policy.id,
          policyName: policy.name,
          enforcement: policy.enforcement,
          entityType,
          entityName,
          rule: failedRule || policy.rules[0],
          actualValue: failedRule ? entity[failedRule.field] : undefined,
          message: `${entityName}: ${policy.name}`,
        });
      }
    };

    const isGlobal = policy.scope === 'global';
    const scopeType = isGlobal ? null : (policy.scope as { type: string }).type;

    // Evaluate against each entity type
    if (isGlobal || scopeType === 'worker') {
      for (const w of entities.workers) {
        checkEntity('worker', w.name, w as unknown as Record<string, unknown>);
      }
    }
    if (isGlobal || scopeType === 'team') {
      for (const t of entities.teams) {
        checkEntity('team', t.name, t as unknown as Record<string, unknown>);
      }
    }
    if (isGlobal || scopeType === 'manager') {
      for (const m of entities.managers) {
        checkEntity('manager', m.name, m as unknown as Record<string, unknown>);
      }
    }
    if (isGlobal || scopeType === 'human') {
      for (const h of entities.humans) {
        checkEntity('human', h.name, h as unknown as Record<string, unknown>);
      }
    }
  }

  return violations;
}
