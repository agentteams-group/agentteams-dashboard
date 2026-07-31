// AlertCore - Core logic for converting Insights to Alerts and dispatching them.
// Combines AlertManager with rule matching and payload generation.

import type { AlertRule, AlertSeverity, NotificationPayload, AlertChannel } from './alert-types';
import { alertManager } from './alert-manager';
import { loadAlertRules, saveAlertRules, buildDefaultRules } from './alert-rules';

/**
 * Generate a NotificationPayload from an AlertRule and an Insight.
 */
function buildNotificationPayload(
  rule: AlertRule,
  insight: { id: string; severity: AlertSeverity; category: string; message: string; detail?: string; actionSection?: string },
): NotificationPayload[] {
  const url = rule.channels.includes('matrix')
    ? `/dashboard/workers/${insight.actionSection || 'overview'}`
    : '/dashboard/overview';

  const payloads: NotificationPayload[] = [];

  rule.channels.forEach((channel) => {
    // For matrix, include the room context (can be extended)
    payloads.push({
      title: `[${severityToEmoji(rule.severity)}] ${rule.insightType.toUpperCase()}: ${insight.message}`,
      body: `详情: ${detailForInsight(insight)}\n规则: ${rule.id}\n阈值: ${JSON.stringify(rule.thresholds) ?? 'N/A'}\n查看: ${url}`,
      severity: rule.severity,
      url,
      insightId: insight.id,
      timestamp: new Date().toISOString(),
      category: insight.category,
    });
  });

  return payloads;
}

/**
 * Convert severity level to emoji for Slack/Matrix display.
 */
function severityToEmoji(sev: AlertSeverity): string {
  switch (sev) {
    case 'critical': return '🔴';
    case 'warning': return '🟡';
    case 'info': return 'ℹ️';
  }
}

/**
 * Format insight detail string for inclusion in notification body.
 */
function detailForInsight(insight: { detail?: string }): string {
  return insight.detail || '查看详情';
}

/**
 * Find all enabled rules that match the given insight.
 * Returns rules where: insight.severity >= rule.severity AND rule.enabled
 */
export function findMatchingRules(
  insight: { id: string; severity: AlertSeverity; insightType?: string; category: string; message: string; detail?: string; actionSection?: string },
  rules: AlertRule[],
): AlertRule[] {
  const severityOrder: AlertSeverity[] = ['info', 'warning', 'critical'];
  const insightLevel = severityOrder.indexOf(insight.severity);
  return rules.filter(
    (rule) =>
      rule.enabled &&
      insightTypeMatches(rule.insightType, insight.insightType || insight.id) &&
      severityOrder.indexOf(rule.severity) <= insightLevel,
  );
}

/**
 * Check if an insight type matches a rule's insight type (supports wildcard).
 * Simple prefix matching for now; expand as needed.
 */
function insightTypeMatches(ruleType: string | undefined, insightInsightType: string | undefined): boolean {
  if (!ruleType || !insightInsightType) return true;
  return insightInsightType.startsWith(ruleType) || insightInsightType === ruleType;
}

/**
 * Process an insight through the alert system: find matching rules, check throttling,
 * generate notifications, and attempt dispatch.
 */
export async function processInsight(
  insight: { id: string; severity: AlertSeverity; category: string; message: string; detail?: string; actionSection?: string },
  adapterMap: Record<string, unknown>,
): Promise<{ success: number; failures: AlertRule[] }> {
  const rules = loadAlertRules();
  const matchingRules = findMatchingRules(insight, rules);
  let successCount = 0;
  const failedRules: AlertRule[] = [];

  for (const rule of matchingRules) {
    if (!alertManager.shouldSend(rule, { id: insight.id, severity: insight.severity })) {
      continue;
    }

    const payloads = buildNotificationPayload(rule, insight);
    for (const payload of payloads) {
      try {
        await alertManager.send(payload, rule, adapterMap);
        alertManager.markAsSent(insight.id);
        successCount++;
      } catch {
        failedRules.push(rule);
      }
    }
  }

  return { success: successCount, failures: failedRules };
}

/**
 * Register all default rules into the global alert manager.
 */
export function initializeAlertManager(): void {
  const rules = loadAlertRules();
  if (rules.length === 0) {
    const defaults = buildDefaultRules();
    saveAlertRules(defaults);
    for (const rule of defaults) {
      alertManager.registerRule(rule);
    }
  } else {
    for (const rule of rules) {
      alertManager.registerRule(rule);
    }
  }
}

/**
 * Update a single alert rule in storage and alert manager.
 */
export function updateAlertRule(updatedRule: AlertRule): void {
  const rules = loadAlertRules();
  const index = rules.findIndex((r) => r.id === updatedRule.id);
  if (index >= 0) {
    rules[index] = { ...updatedRule, updatedAt: Date.now() };
    saveAlertRules(rules);
    // Update the manager's copy
    alertManager.registerRule(rules[index]);
  }
}
