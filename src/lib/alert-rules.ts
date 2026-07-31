// Alert Rule Generator
// Creates default AlertRules based on insight types detected by insights-engine.

import type { AlertRule } from './alert-types';
import { DEFAULT_THRESHOLDS, DEFAULT_THROTTLE_MINUTES } from './alert-types';

/**
 * Generate a default AlertRule for a given insight type.
 * Rules are enabled by default for critical/warning severities.
 */
export function generateDefaultRule(insightType: string): AlertRule {
  const thresholds = DEFAULT_THRESHOLDS[insightType] ?? {};

  // Determine default severity based on insight type patterns
  let severity: AlertRule['severity'] = 'info';
  if (insightType.includes('failed') || insightType.includes('health') || insightType.includes('critical')) {
    severity = 'warning';
  }
  if (insightType.includes('failed') && insightType.includes('worker')) {
    severity = 'critical';
  }

  return {
    id: `rule-${insightType}`,
    insightType,
    severity,
    thresholds,
    channels: ['matrix'],
    recipients: [],
    throttleMinutes: DEFAULT_THROTTLE_MINUTES[severity],
    description: `Auto-generated rule for ${insightType}`,
    enabled: severity !== 'info',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Build a set of default rules covering all known insight types.
 */
export function buildDefaultRules(): AlertRule[] {
  const insightTypes = [
    'failed-workers',
    'stuck-pending',
    'low-worker-health',
    'moderate-worker-health',
    'container-issues',
    'no-matrix-integration',
    'single-runtime-risk',
    'degraded-teams',
    'failed-teams',
    'low-readiness',
    'unhealthy-services',
    'disconnected',
  ];

  return insightTypes.map(generateDefaultRule);
}

/**
 * Load alert rules from localStorage.
 * Returns empty array if no stored rules exist.
 */
export function loadAlertRules(): AlertRule[] {
  try {
    const raw = localStorage.getItem('agentteams-alert-rules');
    if (!raw) return [];
    return JSON.parse(raw) as AlertRule[];
  } catch {
    return [];
  }
}

/**
 * Persist alert rules to localStorage.
 */
export function saveAlertRules(rules: AlertRule[]): void {
  localStorage.setItem('agentteams-alert-rules', JSON.stringify(rules));
}

/**
 * Get or initialize the alert rules set.
 * Loads from storage first; falls back to defaults if empty.
 */
export function getOrInitializeRules(): AlertRule[] {
  const existing = loadAlertRules();
  if (existing.length > 0) {
    return existing;
  }
  const defaults = buildDefaultRules();
  saveAlertRules(defaults);
  return defaults;
}
