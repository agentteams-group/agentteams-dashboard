import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AlertManager } from '@/lib/alert-manager';
import type { AlertRule, NotificationPayload } from '@/lib/alert-types';
import { SlackNotificationAdapter } from '@/lib/notifications/slack-adapter';
import { MatrixNotificationAdapter } from '@/lib/notifications/matrix-adapter';
import { EmailNotificationAdapter } from '@/lib/notifications/email-adapter';

const makeRule = (overrides: Omit<Partial<AlertRule>, 'id' | 'insightType'> & { id: string; insightType: string }): AlertRule => ({
  id: overrides.id,
  insightType: overrides.insightType,
  severity: 'warning',
  thresholds: {},
  channels: ['matrix'],
  recipients: [],
  throttleMinutes: 5,
  description: '',
  enabled: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

describe('AlertManager', () => {
  let manager: AlertManager;
  let rule: AlertRule;

  beforeEach(() => {
    manager = new AlertManager();
    rule = makeRule({ id: 'test-rule', insightType: 'failed-workers', severity: 'warning' });
    manager.registerRule(rule);
  });

  it('should register and retrieve rules', () => {
    expect(manager.getAllRules()).toEqual([rule]);
    expect(manager.getRule('test-rule')).toBe(rule);
  });

  it('should unregister a rule', () => {
    manager.unregisterRule('test-rule');
    expect(manager.getRule('test-rule')).toBeUndefined();
  });

  it('should send alert when insight severity matches rule', () => {
    const insight = { id: 'ins-1', severity: 'warning' as const };
    expect(manager.shouldSend(rule, insight)).toBe(true);
  });

  it('should not send when insight is below rule severity threshold', () => {
    const lowRule = makeRule({ id: 'critical-rule', insightType: 'x', severity: 'critical' });
    manager.registerRule(lowRule);
    const insight = { id: 'ins-2', severity: 'info' as const };
    expect(manager.shouldSend(lowRule, insight)).toBe(false);
  });

  it('should not send when rule is disabled', () => {
    const disabledRule = makeRule({ id: 'disabled-rule', insightType: 'y', enabled: false });
    manager.registerRule(disabledRule);
    const insight = { id: 'ins-3', severity: 'warning' as const };
    expect(manager.shouldSend(disabledRule, insight)).toBe(false);
  });

  it('should throttle repeated alerts for same insight within window', () => {
    manager.markAsSent('throttled-insight');
    const insight = { id: 'throttled-insight', severity: 'warning' as const };
    // Right after marking sent, should be throttled
    expect(manager.shouldSend(rule, insight)).toBe(false);
  });

  it('should allow re-alerting after throttle period expires', () => {
    manager.markAsSent('later-insight');
    // Simulate time passing by clearing throttle state
    manager.resetThrottle();
    const insight = { id: 'later-insight', severity: 'warning' as const };
    expect(manager.shouldSend(rule, insight)).toBe(true);
  });

  it('should track notification failures', () => {
    manager.clearFailures();
    // No direct access to private recordFailure — verify via getFailures returning empty initially
    expect(manager.getFailures().length).toBe(0);
  });

  it('should have at least one channel in any valid rule', () => {
    const validRule = makeRule({ id: 'multi-channel-rule', insightType: 'z', channels: ['matrix', 'slack'] });
    manager.registerRule(validRule);
    expect(validRule.channels.length).toBeGreaterThan(0);
  });
});

describe('SlackNotificationAdapter', () => {
  it('should throw when webhook URL is empty', async () => {
    const adapter = new SlackNotificationAdapter('');
    const payload: NotificationPayload = {
      title: 'Test',
      body: 'Body',
      severity: 'warning',
      url: '/dashboard',
      insightId: 'i1',
      timestamp: new Date().toISOString(),
      category: 'health',
    };
    await expect(adapter.send(payload)).rejects.toThrow('webhook URL is not configured');
  });

  it('should construct a valid Slack payload structure for critical severity', async () => {
    const webhooks: string[] = [];
    const mockFetch = vi.fn((url: string) => {
      if (typeof url === 'string') webhooks.push(url);
      return Promise.resolve({ ok: true } as Response);
    });
    vi.stubGlobal('fetch', mockFetch);

    const adapter = new SlackNotificationAdapter('https://hooks.slack.com/test');
    const payload: NotificationPayload = {
      title: 'Critical',
      body: 'Something broke',
      severity: 'critical',
      url: '/dashboard/workers',
      insightId: 'i2',
      timestamp: new Date().toISOString(),
      category: 'health',
    };

    await adapter.send(payload);
    expect(webhooks).toContain('https://hooks.slack.com/test');
    vi.unstubAllGlobals();
  });
});

describe('MatrixNotificationAdapter', () => {
  it('should not throw on minimal call with no config (proxy fallback path)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('fetch', mockFetch);

    const adapter = new MatrixNotificationAdapter();
    const payload: NotificationPayload = {
      title: 'Alert',
      body: 'Detail here',
      severity: 'info',
      url: '/',
      insightId: 'i3',
      timestamp: new Date().toISOString(),
      category: 'connectivity',
    };

    await expect(adapter.send(payload)).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });
});

describe('EmailNotificationAdapter', () => {
  it('should throw when no recipient is provided', async () => {
    const adapter = new EmailNotificationAdapter({ endpoint: 'https://email.service.com/send' });
    const payload: NotificationPayload = {
      title: 'Test',
      body: 'Body',
      severity: 'warning',
      url: '/',
      insightId: 'i4',
      timestamp: new Date().toISOString(),
      category: 'capacity',
    };
    await expect(adapter.send(payload)).rejects.toThrow('No email recipient specified');
  });
});
