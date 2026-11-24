import { toast } from 'sonner';
import type { MatrixEvent } from './matrix-api';
import { assistantReminderKey, useNotificationStore } from './notification-store';
import { openNotificationTarget } from './notification-nav';

/** Called only for rooms joined by the authenticated Matrix user. */
export function ingestAssistantReminders(roomId: string, events: MatrixEvent[], userId: string, live: boolean) {
  for (const event of events) {
    const marker = event.content?.['org.agentteams.assistant_reminder'];
    if (event.type !== 'm.room.message' || !marker || typeof marker !== 'object' || event.sender === userId) continue;
    const reminder = marker as Record<string, unknown>;
    if (reminder.recipient !== userId || typeof reminder.title !== 'string' || typeof event.content.body !== 'string') continue;
    const notification = { type: 'info' as const, kind: 'assistant' as const, origin: 'system' as const,
      title: `${reminder.title}发来一条提醒`, message: event.content.body.replace(/\s+/g, ' ').slice(0, 160),
      roomId, sourceEventId: event.event_id, recipientId: userId };
    const store = useNotificationStore.getState();
    const key = assistantReminderKey(notification);
    if (key && store.seenAssistantReminders[key]) continue;
    store.addNotification(notification);
    // Historical sync populates the inbox without replaying old toast popups.
    if (live) toast(notification.title, { description: notification.message.length > 72 ? notification.message.slice(0, 72) + '…' : notification.message, duration: 8000,
      action: { label: '查看助手会话', onClick: () => {
        const saved = useNotificationStore.getState().notifications.find(n => n.sourceEventId === event.event_id && n.recipientId === userId);
        if (saved) {
          useNotificationStore.getState().markAsRead(saved.id);
          openNotificationTarget(saved);
        }
      } } });
  }
}
