// Alert System Type Definitions
// Defines interfaces for AlertManager, notification rules, and payloads.

export type AlertSeverity = 'info' | 'warning' | 'critical';

export type AlertChannel = 'matrix' | 'slack' | 'email';

/**
 * Represents a notification channel configuration for an alert rule.
 */
export interface NotificationConfig {
  /** Webhook URL for Slack notifications */
  webhookUrl?: string;
  /** Email address for email notifications */
  email?: string;
}

/**
 * Configuration for when an insight should trigger an alert.
 */
export interface AlertRule {
  /** Unique identifier for the rule */
  id: string;
  /** Insight type this rule monitors (e.g., 'failed-workers', 'low-health') */
  insightType: string;
  /** Minimum severity level to alert on */
  severity: AlertSeverity;
  /** Custom thresholds for this rule (override defaults) */
  thresholds?: Record<string, number>;
  /** Notification channels to use (matrix required for critical) */
  channels: AlertChannel[];
  /** Recipients for each channel (user IDs, emails, or webhook URLs) */
  recipients: string[];
  /** Minimum time between repeated alerts in minutes (default: 15) */
  throttleMinutes?: number;
  /** Human-readable description of this rule */
  description?: string;
  /** Whether this rule is currently active */
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Payload sent to notification adapters when an alert fires.
 */
export interface NotificationPayload {
  /** Alert title (human-readable) */
  title: string;
  /** Alert body message */
  body: string;
  /** Severity level */
  severity: AlertSeverity;
  /** Deep link to the relevant dashboard page */
  url: string;
  /** The original insight that triggered this alert */
  insightId: string;
  /** ISO timestamp when alert was generated */
  timestamp: string;
  /** Insight category for filtering */
  category: string;
}

/**
 * Base interface for all notification adapters.
 */
export interface NotificationAdapter {
  /** Send a notification payload to the configured channel */
  send(payload: NotificationPayload, config?: unknown): Promise<void>;
}

/**
 * Metadata about a failed notification attempt.
 */
export interface AlertFailure {
  id: string;
  insightId: string;
  channel: AlertChannel;
  recipient: string;
  error: string;
  retryCount: number;
  timestamp: string;
}

/**
 * Response from the alert settings API.
 */
export interface AlertRulesResponse {
  rules: AlertRule[];
}

export interface AlertRuleRequest {
  id?: string;
  insightType: string;
  severity: AlertSeverity;
  thresholds?: Record<string, number>;
  channels: AlertChannel[];
  recipients: string[];
  throttleMinutes?: number;
  description?: string;
  enabled?: boolean;
}

/**
 * Default thresholds for common insight types.
 */
export const DEFAULT_THRESHOLDS: Record<string, Record<string, number>> = {
  'failed-workers': { count: 0 },
  'stuck-pending': { count: 2 },
  'low-worker-health': { score: 50 },
  'container-issues': { count: 0 },
  'degraded-teams': { count: 0 },
  'failed-teams': { count: 0 },
};

/**
 * Default throttle minutes per severity level.
 */
export const DEFAULT_THROTTLE_MINUTES: Record<AlertSeverity, number> = {
  info: 60,
  warning: 30,
  critical: 5,
};

/**
 * Map of severity levels to their numeric priority for sorting.
 */
export const SEVERITY_PRIORITY: Record<AlertSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};
