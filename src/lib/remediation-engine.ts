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
