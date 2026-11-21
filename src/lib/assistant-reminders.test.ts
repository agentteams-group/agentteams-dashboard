import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ingestAssistantReminders } from './assistant-reminders';
import { useNotificationStore } from './notification-store';
import type { MatrixEvent } from './matrix-api';
import { toast } from 'sonner';

vi.mock('sonner', () => ({ toast: vi.fn() }));
const event = { event_id: '$digest', sender: '@leader:test', type: 'm.room.message', origin_server_ts: 1,
  content: { body: '团队协作动态与今日待办', 'org.agentteams.assistant_reminder': { title: '研发团队助手', recipient: '@alice:test', requestId: 'daily-1' } } } as MatrixEvent;
beforeEach(() => { useNotificationStore.setState({ notifications: [] }); vi.clearAllMocks(); });
describe('assistant reminders', () => {
  it('shows a toast for a new live reminder and opens its original conversation', () => {
    ingestAssistantReminders('!assistant:test', [event], '@alice:test', true);
    expect(toast).toHaveBeenCalledOnce();
    const action = vi.mocked(toast).mock.calls[0][1]?.action;
    if (!action || typeof action !== 'object' || !('onClick' in action)) throw new Error('missing reminder action');
    action.onClick({} as React.MouseEvent<HTMLButtonElement>);
    expect(window.location.hash).toBe('#workbench/space/!assistant:test');
    expect(useNotificationStore.getState().notifications[0].read).toBe(true);
  });
  it('keeps one notification across repeated sync batches with its conversation target', () => {
    for (let i = 0; i < 2; i++) ingestAssistantReminders('!assistant:test', [event], '@alice:test', false);
    const notifications = useNotificationStore.getState().notifications;
    expect(notifications).toHaveLength(1);
    expect(toast).not.toHaveBeenCalled();
    expect(notifications[0]).toMatchObject({ roomId: '!assistant:test', recipientId: '@alice:test', sourceEventId: '$digest', kind: 'assistant', title: '研发团队助手发来一条提醒' });
  });
  it('does not notify another user, self echo, redaction or ordinary messages', () => {
    ingestAssistantReminders('!assistant:test', [event], '@bob:test', true);
    ingestAssistantReminders('!assistant:test', [{ ...event, sender: '@alice:test' }], '@alice:test', true);
    ingestAssistantReminders('!assistant:test', [{ ...event, content: {} }], '@alice:test', true);
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });
});
