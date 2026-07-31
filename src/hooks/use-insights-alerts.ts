// useInsightsAlerts Hook
// Connects insights-engine output to the alert system.
// Watches for new Insights with severity >= warning and dispatches them through AlertManager.

import { useEffect, useRef } from 'react';
import { alertManager } from '@/lib/alert-manager';
import { initializeAlertManager, processInsight } from '@/lib/alert-core';
import { createDefaultAdapters } from '@/lib/notifications/base-adapter';
import type { Insight } from '@/lib/insights-engine';

const MIN_ALERT_SEVERITY = 'warning' as const;

/**
 * Hook that automatically processes insights from the dashboard and routes
 * them through the alert system when they match configured rules.
 */
export function useInsightsAlerts(insights: Insight[]): void {
  const lastProcessedRef = useRef<string[]>([]);
  const adaptersRef = useRef(createDefaultAdapters());

  // Initialize alert manager with stored/default rules on mount
  useEffect(() => {
    initializeAlertManager();
  }, []);

  useEffect(() => {
    if (!insights || insights.length === 0) return;

    const processed = insights.map((i) => i.id);
    const newInsights = insights.filter((i) => !lastProcessedRef.current.includes(i.id));

    if (newInsights.length === 0) return;
    lastProcessedRef.current = [...lastProcessedRef.current.slice(-100), ...processed];

    let shouldResetThrottle = false;

    const dispatchInsights = async () => {
      for (const insight of newInsights) {
        const severityOrder = ['info', 'warning', 'critical'];
        const insightLevel = severityOrder.indexOf(insight.severity);
        if (insightLevel < severityOrder.indexOf(MIN_ALERT_SEVERITY)) continue;

        try {
          const result = await processInsight(insight, adaptersRef.current);
          void result;
        } catch (error) {
          console.error('[useInsightsAlerts] Failed to process insight:', error);
          shouldResetThrottle = true;
        }
      }
    };

    void dispatchInsights();

    if (shouldResetThrottle) {
      alertManager.resetThrottle();
    }
  }, [insights]);
}

/**
 * Hook that exposes alert state for UI rendering (failure counts, rule list).
 */
export function useAlertStatus() {
  const rules = alertManager.getAllRules();
  const failures = alertManager.getFailures();

  return {
    rules,
    failureCount: failures.length,
    criticalFailureCount: failures.filter((f) => f.channel !== 'matrix').length,
  };
}
