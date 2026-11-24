import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NotificationPopover } from '@/components/dashboard/notification-popover';
import { ingestAssistantReminders } from '@/lib/assistant-reminders';
import { useNotificationStore } from '@/lib/notification-store';
import { useMatrixStore } from '@/lib/matrix-store';
import { useSectionStore } from '@/lib/section-store';
import type { MatrixEvent } from '@/lib/matrix-api';
import { toast } from 'sonner';

vi.mock('sonner', () => ({ toast: vi.fn() }));

beforeEach(() => {
  localStorage.clear();
  useNotificationStore.setState({ notifications: [], seenAssistantReminders: {} });
  useMatrixStore.setState({ userId: '@alice:test', accessToken: '', isLoggedIn: false });
  useSectionStore.setState({ notificationsOpen: false });
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  useNotificationStore.setState({ notifications: [], seenAssistantReminders: {} });
  useSectionStore.setState({ notificationsOpen: false });
});

async function openAliceNotifications() {
  for (const user of ['alice', 'bob']) {
    useNotificationStore.getState().addNotification({
      type: 'info', kind: 'assistant', title: `${user} reminder`, message: 'team update',
      recipientId: `@${user}:test`, roomId: `!${user}:test`, sourceEventId: `$${user}`,
    });
  }
  useNotificationStore.getState().addNotification({ type: 'info', title: 'shared system notice', message: 'status' });
  render(<NotificationPopover />);
  fireEvent.click(screen.getByRole('button', { name: /通知（2 条未读）/ }));
  await screen.findByText('alice reminder');
  expect(screen.queryByText('bob reminder')).toBeNull();
}

async function reloadNotifications() {
  const persisted = localStorage.getItem('agentteams-notifications');
  expect(persisted).not.toBeNull();
  useNotificationStore.setState({ notifications: [], seenAssistantReminders: {} });
  localStorage.setItem('agentteams-notifications', persisted!);
  await useNotificationStore.persist.rehydrate();
}

function reminder(index: number, recipient = '@alice:test') {
  return {
    event_id: `$reminder-${index}`, sender: '@leader:test', type: 'm.room.message',
    origin_server_ts: 1000 + index,
    content: {
      body: `team update ${index}`,
      'org.agentteams.assistant_reminder': {
        title: '团队助手', recipient, requestId: `request-${index}`,
      },
    },
  } as MatrixEvent;
}

describe('assistant notification account isolation and persistence', () => {
  it('Alice marking all visible reminders read leaves Bob unread', async () => {
    await openAliceNotifications();
    fireEvent.click(screen.getByRole('button', { name: '全部已读' }));
    const notifications = useNotificationStore.getState().notifications;
    expect(notifications.find(n => n.recipientId === '@alice:test')?.read).toBe(true);
    expect(notifications.find(n => !n.recipientId)?.read).toBe(true);
    expect(notifications.find(n => n.recipientId === '@bob:test')?.read).toBe(false);
  });

  it('Alice clearing visible reminders retains Bob reminders', async () => {
    await openAliceNotifications();
    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    const notifications = useNotificationStore.getState().notifications;
    expect(notifications.filter(n => n.recipientId === '@alice:test')).toHaveLength(0);
    expect(notifications.filter(n => !n.recipientId)).toHaveLength(0);
    expect(notifications.filter(n => n.recipientId === '@bob:test')).toHaveLength(1);
  });

  it('21 read reminders across three rooms stay read after real persistence rehydration and historical sync', async () => {
    const reminders = Array.from({ length: 21 }, (_, i) => ({
      roomId: `!assistant-${Math.floor(i / 7)}:test`,
      event: reminder(i),
    }));
    const replay = () => {
      for (const { roomId, event } of reminders) {
        ingestAssistantReminders(roomId, [event], '@alice:test', false);
      }
    };
    replay();
    expect(useNotificationStore.getState().notifications).toHaveLength(21);
    useNotificationStore.getState().markAllRead('@alice:test');
    expect(useNotificationStore.getState().unreadCount()).toBe(0);

    const persisted = localStorage.getItem('agentteams-notifications');
    expect(persisted).not.toBeNull();
    expect(JSON.parse(persisted!).state.notifications).toHaveLength(20);
    await reloadNotifications();
    expect(useNotificationStore.getState().notifications).toHaveLength(20);
    expect(useNotificationStore.getState().unreadCount()).toBe(0);

    replay();
    expect(toast).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().unreadCount()).toBe(0);
  });

  it('does not recreate cleared reminders after reload, while admitting a genuinely new one', async () => {
    ingestAssistantReminders('!assistant:test', [reminder(0)], '@alice:test', true);
    useNotificationStore.getState().clearAll('@alice:test');
    await reloadNotifications();
    vi.clearAllMocks();
    ingestAssistantReminders('!assistant:test', [reminder(0)], '@alice:test', true);
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
    expect(toast).not.toHaveBeenCalled();
    ingestAssistantReminders('!assistant:test', [reminder(1)], '@alice:test', true);
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
    expect(toast).toHaveBeenCalledOnce();
  });

  it('retains event deduplication after the 50-item in-memory list evicts a reminder', () => {
    const events = Array.from({ length: 51 }, (_, i) => reminder(i));
    ingestAssistantReminders('!assistant:test', events, '@alice:test', true);
    expect(useNotificationStore.getState().notifications).toHaveLength(50);
    vi.clearAllMocks();
    ingestAssistantReminders('!assistant:test', [events[0]], '@alice:test', true);
    expect(toast).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().notifications.some(n => n.sourceEventId === '$reminder-0')).toBe(false);
  });

  it('does not suppress other recipients, rooms, out-of-order or equal-timestamp events', () => {
    ingestAssistantReminders('!first:test', [reminder(10), reminder(0)], '@alice:test', true);
    ingestAssistantReminders('!first:test', [{ ...reminder(1), origin_server_ts: 1000 }], '@alice:test', true);
    ingestAssistantReminders('!second:test', [reminder(0)], '@alice:test', true);
    ingestAssistantReminders('!first:test', [reminder(0, '@bob:test')], '@bob:test', true);
    expect(useNotificationStore.getState().notifications).toHaveLength(5);
    expect(toast).toHaveBeenCalledTimes(5);
  });

  it('migrates v1 reminders without losing their read state or deduplication after clearing', async () => {
    ingestAssistantReminders('!assistant:test', [reminder(0)], '@alice:test', false);
    const notifications = useNotificationStore.getState().notifications.map(n => ({ ...n, read: true }));
    const legacy = JSON.stringify({ version: 1, state: { notifications } });
    useNotificationStore.setState({ notifications: [], seenAssistantReminders: {} });
    localStorage.setItem('agentteams-notifications', legacy);
    await useNotificationStore.persist.rehydrate();
    expect(useNotificationStore.getState().notifications[0].read).toBe(true);
    expect(JSON.parse(localStorage.getItem('agentteams-notifications')!).version).toBe(2);
    useNotificationStore.getState().clearAll('@alice:test');
    await reloadNotifications();
    ingestAssistantReminders('!assistant:test', [reminder(0)], '@alice:test', false);
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });
});
