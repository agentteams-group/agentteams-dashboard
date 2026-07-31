// Slack Notification Adapter
// Sends alert payloads via Slack Incoming Webhooks.

import type { NotificationPayload, NotificationAdapter } from '@/lib/alert-types';

type SlackAttachmentColor = 'danger' | 'warning' | 'good';

function severityToColor(severity: NotificationPayload['severity']): SlackAttachmentColor {
  switch (severity) {
    case 'critical':
      return 'danger';
    case 'warning':
      return 'warning';
    case 'info':
      return 'good';
  }
}

export class SlackNotificationAdapter implements NotificationAdapter {
  private readonly webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  async send(payload: NotificationPayload, config?: { webhookUrl?: string }): Promise<void> {
    const url = config?.webhookUrl ?? this.webhookUrl;
    if (!url) {
      throw new Error('Slack webhook URL is not configured');
    }

    const color = severityToColor(payload.severity);
    const body = JSON.stringify({
      attachments: [
        {
          color,
          title: payload.title,
          text: payload.body,
          fields: [
            { title: 'Severity', value: payload.severity, short: true },
            { title: 'Category', value: payload.category, short: true },
          ],
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!response.ok) {
      throw new Error(`Slack webhook returned ${response.status}: ${await response.text().catch(() => '')}`);
    }
  }
}
