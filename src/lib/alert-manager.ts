// AlertManager - Central coordinator for alert processing and notification dispatch.
// Receives Insights, evaluates matching rules, applies throttling, and dispatches
// notifications through configured channels via adapter plugins.

import { v4 as uuidv4 } from 'uuid';
import type { AlertRule, AlertSeverity, NotificationPayload, AlertFailure, AlertChannel } from './alert-types';
import { DEFAULT_THROTTLE_MINUTES } from './alert-types';

export interface AlertManagerConfig {
  /** Rules that determine when and how to alert */
  rules: AlertRule[];
  /** Adapter instance for each channel type */
  adapters: Record<string, unknown>;
}

/**
 * AlertManager class responsible for:
 * 1. Evaluating which rules match an incoming insight
 * 2. Throttling repeated alerts for the same insight
 * 3. Dispatching notifications through configured channels
 * 4. Tracking failed sends with retry logging
 */
export class AlertManager {
  private rules: Map<string, AlertRule> = new Map();
  private lastSentTimestamps: Map<string, number> = new Map();
  private failures: AlertFailure[] = [];

  constructor(config?: Partial<AlertManagerConfig>) {
    if (config?.rules) {
      for (const rule of config.rules) {
        this.registerRule(rule);
      }
    }
  }

  /** Register or update a single alert rule */
  registerRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
  }

  /** Bulk register multiple rules */
  registerRules(rules: AlertRule[]): void {
    for (const rule of rules) {
      this.registerRule(rule);
    }
  }

  /** Remove a rule by ID */
  unregisterRule(id: string): void {
    this.rules.delete(id);
  }

  /** Get all currently registered rules */
  getAllRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }

  /** Get a rule by ID */
  getRule(id: string): AlertRule | undefined {
    return this.rules.get(id);
  }

  /**
   * Determine whether an alert should be sent for a given insight and rule.
   * Checks: rule enabled, severity threshold, throttle window.
   */
  shouldSend(rule: AlertRule, insight: { id: string; severity: AlertSeverity }): boolean {
    if (!rule.enabled) return false;

    // Severity check: only send if insight severity >= rule severity
    const severityOrder: AlertSeverity[] = ['info', 'warning', 'critical'];
    const insightLevel = severityOrder.indexOf(insight.severity);
    const ruleLevel = severityOrder.indexOf(rule.severity);
    if (insightLevel < ruleLevel) return false;

    // Throttle check: same insightId within throttle window
    const now = Date.now();
    const lastSent = this.lastSentTimestamps.get(insight.id) ?? 0;
    const throttleMs = ((rule.throttleMinutes ?? DEFAULT_THROTTLE_MINUTES[rule.severity]) * 60 * 1000);
    if (now - lastSent < throttleMs) return false;

    return true;
  }

  /**
   * Record that an alert was just sent, updating the throttle timestamp.
   */
  markAsSent(insightId: string): void {
    this.lastSentTimestamps.set(insightId, Date.now());
  }

  /**
   * Send a notification payload through all configured channels for a rule.
   * Each adapter is looked up dynamically by channel name.
   */
  async send(payload: NotificationPayload, rule: AlertRule, adapterMap: Record<string, unknown>): Promise<void> {
    for (const channel of rule.channels) {
      const adapter = (adapterMap as Record<string, { send: (p: NotificationPayload, c: unknown) => Promise<void> }>)[channel];
      if (!adapter || typeof adapter.send !== 'function') {
        this.recordFailure(payload.insightId, channel, '', 'No adapter configured for channel: ' + channel);
        continue;
      }
      await this.sendWithRetry(adapter.send.bind(adapter), payload, channel, rule.recipients[0] ?? '');
    }
  }

  /** Retry logic with exponential backoff (1s, 2s, 4s) */
  private async sendWithRetry(
    sendFn: (payload: NotificationPayload, config?: unknown) => Promise<void>,
    payload: NotificationPayload,
    channel: AlertChannel,
    recipient: string,
  ): Promise<void> {
    const maxRetries = 3;
    const delays = [1000, 2000, 4000];
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await sendFn(payload, undefined);
        return;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, delays[attempt]));
          continue;
        }
        this.recordFailure(payload.insightId, channel, recipient, errorMsg);
      }
    }
  }

  /** Record a notification failure for later debugging */
  private recordFailure(insightId: string, channel: AlertChannel, recipient: string, error: string): void {
    this.failures.push({
      id: uuidv4(),
      insightId,
      channel,
      recipient,
      error,
      retryCount: 3,
      timestamp: new Date().toISOString(),
    });
    // Keep only the last 50 failures
    if (this.failures.length > 50) {
      this.failures = this.failures.slice(-50);
    }
  }

  /** Get recent notification failures */
  getFailures(): AlertFailure[] {
    return [...this.failures];
  }

  /** Clear all recorded failures */
  clearFailures(): void {
    this.failures = [];
  }

  /** Get current throttle status for an insight */
  getThrottleStatus(insightId: string): { lastSentAt: number | null; remainingMs: number | null } {
    const lastSent = this.lastSentTimestamps.get(insightId) ?? 0;
    if (lastSent === 0) {
      return { lastSentAt: null, remainingMs: null };
    }
    const elapsed = Date.now() - lastSent;
    return {
      lastSentAt: lastSent,
      remainingMs: Math.max(0, 60_000 - elapsed), // show rough remaining window
    };
  }

  /** Reset all throttle timestamps (e.g. after settings change) */
  resetThrottle(): void {
    this.lastSentTimestamps.clear();
  }
}

/**
 * Global singleton instance — used by useInsightsAlerts hook.
 */
export const alertManager = new AlertManager();
