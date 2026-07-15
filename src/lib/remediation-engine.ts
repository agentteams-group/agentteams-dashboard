// Auto-Remediation Engine
// Executes automatic actions when policy violations are detected

import type { PolicyViolation } from './policy-engine';

export interface RemediationAction {
  id: string;
  policyId: string;
  policyName: string;
  entityType: string;
  entityName: string;
  action: 'restart' | 'sleep' | 'wake' | 'notify' | 'flag';
  reason: string;
  executedAt?: number;
  result?: 'success' | 'failed' | 'skipped';
  error?: string;
}

// Rate limit: max N remediation actions per minute
const MAX_ACTIONS_PER_MINUTE = 10;
const actionTimestamps: number[] = [];

function canExecute(): boolean {
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;
  // Clean old timestamps
  while (actionTimestamps.length > 0 && actionTimestamps[0] < oneMinuteAgo) {
    actionTimestamps.shift();
  }
  return actionTimestamps.length < MAX_ACTIONS_PER_MINUTE;
}

function recordExecution() {
  actionTimestamps.push(Date.now());
}

/**
 * Determine what remediation action to take for a given violation.
 * Returns null if no automatic action is appropriate.
 */
export function determineRemediation(violation: PolicyViolation): RemediationAction | null {
  // Only auto-remediate policies with 'auto-remediate' enforcement
  if (violation.enforcement !== 'auto-remediate') return null;

  // Worker-specific remediations
  if (violation.entityType === 'worker') {
    // Failed worker → restart
    if (violation.rule.field === 'phase' && violation.actualValue === 'Failed') {
      return {
        id: `rem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        policyId: violation.policyId,
        policyName: violation.policyName,
        entityType: 'worker',
        entityName: violation.entityName,
        action: 'restart',
        reason: `Worker "${violation.entityName}" 处于 Failed 状态，自动重启`,
      };
    }

    // Sleeping worker that should be running → wake
    if (violation.rule.field === 'phase' && violation.rule.value === 'Running' && violation.actualValue === 'Sleeping') {
      return {
        id: `rem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        policyId: violation.policyId,
        policyName: violation.policyName,
        entityType: 'worker',
        entityName: violation.entityName,
        action: 'wake',
        reason: `Worker "${violation.entityName}" 应为 Running 但处于 Sleeping，自动唤醒`,
      };
    }
  }

  // For other violations, just flag for notification
  return {
    id: `rem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    policyId: violation.policyId,
    policyName: violation.policyName,
    entityType: violation.entityType,
    entityName: violation.entityName,
    action: 'flag',
    reason: `策略 "${violation.policyName}" 违规: ${violation.message}`,
  };
}

/**
 * Execute a remediation action.
 * Returns a function that takes the mutation hooks as arguments.
 * This is designed to be called from a React component.
 */
export function getRemediationDescription(action: RemediationAction): string {
  switch (action.action) {
    case 'restart':
      return `重启 Worker "${action.entityName}"`;
    case 'wake':
      return `唤醒 Worker "${action.entityName}"`;
    case 'sleep':
      return `休眠 Worker "${action.entityName}"`;
    case 'notify':
      return `通知: ${action.reason}`;
    case 'flag':
      return `标记: ${action.reason}`;
    default:
      return action.reason;
  }
}

/**
 * Process violations and return remediation actions to execute.
 * Filters by rate limit and deduplication.
 */
export function planRemediations(
  violations: PolicyViolation[],
  recentActions: RemediationAction[]
): RemediationAction[] {
  if (!canExecute()) return [];

  const actions: RemediationAction[] = [];
  const recentTargets = new Set(
    recentActions
      .filter((a) => a.executedAt && Date.now() - a.executedAt < 300_000) // 5 min cooldown
      .map((a) => `${a.entityType}:${a.entityName}:${a.action}`)
  );

  for (const violation of violations) {
    const action = determineRemediation(violation);
    if (!action) continue;

    // Deduplicate: don't re-act on same entity+action within 5 min
    const key = `${action.entityType}:${action.entityName}:${action.action}`;
    if (recentTargets.has(key)) continue;

    if (!canExecute()) break;
    recordExecution();
    actions.push(action);
  }

  return actions;
}
