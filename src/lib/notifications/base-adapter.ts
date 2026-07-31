// Base Notification Adapter - abstract interface for channel implementations.
// Each adapter handles sending alerts through a specific channel (Slack, Email, Matrix).

import type { NotificationPayload, NotificationAdapter } from '@/lib/alert-types';
import { MatrixNotificationAdapter } from './matrix-adapter';
import { SlackNotificationAdapter } from './slack-adapter';
import { EmailNotificationAdapter } from './email-adapter';

export interface AdapterConfig {
  id: string;
  channel: 'matrix' | 'slack' | 'email';
  ready: boolean;
  lastError?: string;
}

export abstract class BaseNotificationAdapter {
  protected config: AdapterConfig;

  constructor(config: AdapterConfig) {
    this.config = config;
  }

  abstract send(payload: NotificationPayload, config?: unknown): Promise<void>;

  getChannel(): 'matrix' | 'slack' | 'email' {
    return this.config.channel;
  }

  markReady(): void {
    this.config.ready = true;
    this.config.lastError = undefined;
  }

  markError(error: Error | string): void {
    this.config.ready = false;
    this.config.lastError = typeof error === 'string' ? error : error.message;
  }
}

export function createDefaultAdapters(): Record<string, NotificationAdapter> {
  const matrixAdapter = new MatrixNotificationAdapter();
  const slackAdapter = new SlackNotificationAdapter('');
  const emailAdapter = new EmailNotificationAdapter({ endpoint: '' });

  return {
    matrix: matrixAdapter,
    slack: slackAdapter,
    email: emailAdapter,
  };
}
