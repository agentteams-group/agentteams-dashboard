// Matrix Notification Adapter
// Wraps the existing matrixApi to send alert messages to Matrix rooms.

import type { NotificationPayload, NotificationAdapter } from '@/lib/alert-types';
import { apiUrl } from '@/lib/api-base';

interface MatrixSendOptions {
  homeserver: string;
  accessToken: string;
  roomId: string;
}

const SEVERITY_TO_MATRIX_COLOR: Record<string, string> = {
  critical: '#FF0000',
  warning: '#FFA500',
  info: '#0000FF',
};

export class MatrixNotificationAdapter implements NotificationAdapter {
  async send(payload: NotificationPayload, config?: MatrixSendOptions): Promise<void> {
    if (!config?.homeserver || !config?.accessToken || !config?.roomId) {
      // Try to send via the proxy endpoint without explicit params
      await this.sendViaProxy(payload);
      return;
    }

    const color = SEVERITY_TO_MATRIX_COLOR[payload.severity] || '#888888';
    const formattedBody = `<font color="${color}"><b>[${payload.severity.toUpperCase()}]</b></font> ${payload.title}\n\n${payload.body}`;

    await fetch(apiUrl(`/api/matrix/rooms/${encodeURIComponent(config.roomId)}/send`), {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        msgtype: 'm.text',
        body: `[${payload.severity.toUpperCase()}] ${payload.title}`,
        formatted_body: formattedBody,
        format: 'org.matrix.custom.html',
        url: payload.url,
      }),
    }).then((res) => {
      if (!res.ok) throw new Error(`Matrix send failed: ${res.status}`);
    });
  }

  private async sendViaProxy(payload: NotificationPayload): Promise<void> {
    await fetch(apiUrl('/api/matrix/alert'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: payload.title,
        body: payload.body,
        severity: payload.severity,
        category: payload.category,
        url: payload.url,
      }),
    }).then((res) => {
      if (!res.ok) throw new Error(`Matrix alert proxy failed: ${res.status}`);
    });
  }
}
