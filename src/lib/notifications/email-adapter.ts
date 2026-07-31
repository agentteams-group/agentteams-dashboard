// Email Notification Adapter (REST API based)
// Sends alert payloads via a simple HTTP-based email service (e.g., SendGrid, AWS SES REST).
// Configurable through the `url` option pointing to an email-sending endpoint.

import type { NotificationPayload, NotificationAdapter } from '@/lib/alert-types';

interface EmailPayload {
  to: string[];
  subject: string;
  body: string;
  severity: NotificationPayload['severity'];
}

export interface EmailAdapterOptions {
  endpoint: string;
  apiKey?: string;
  fromEmail?: string;
}

export class EmailNotificationAdapter implements NotificationAdapter {
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly fromEmail?: string;

  constructor(options: EmailAdapterOptions) {
    this.endpoint = options.endpoint;
    this.apiKey = options.apiKey;
    this.fromEmail = options.fromEmail;
  }

  async send(payload: NotificationPayload, config?: { recipients?: string[]; to?: string }): Promise<void> {
    const recipients = config?.recipients ?? [];
    const to = [...(config?.to ? [config.to] : []), ...recipients].filter((v): v is string => typeof v === 'string');
    if (to.length === 0) {
      throw new Error('No email recipient specified');
    }

    const severityLabel = payload.severity.toUpperCase();
    const subject = `[${severityLabel}] ${payload.title.replace(/^[\u{1F1E6}-\u{1F1FF}|\u{26A0}|\u{26AA}-\u{27B0}]+/u, '').trim()}`;

    const body: EmailPayload = {
      to,
      subject,
      body: `${payload.body}\n\n详情: ${payload.url}`,
      severity: payload.severity,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...body,
        from: this.fromEmail ?? 'alerts@agentteams.local',
      }),
    });

    if (!response.ok) {
      throw new Error(`Email API returned ${response.status}: ${await response.text().catch(() => '')}`);
    }
  }
}
