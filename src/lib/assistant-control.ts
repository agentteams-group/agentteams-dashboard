/** Background Teams wakeups are control traffic, not user-facing reminders. */
export function isAssistantControlEvent(event: {
  type?: string; sender?: string; content?: Record<string, unknown>;
}): boolean {
  if (event.type !== 'm.room.message' || event.content?.msgtype !== 'm.notice') return false;
  const control = event.content['org.agentteams.coordination'] as {
    channel_meta?: { sender_id?: string; agent_matrix_user_id?: string;
      teamharness_coordination?: { kind?: string } };
  } | undefined;
  const meta = control?.channel_meta;
  return meta?.teamharness_coordination?.kind === 'assistant_digest'
    && typeof event.sender === 'string'
    && meta.sender_id === event.sender && meta.agent_matrix_user_id === event.sender;
}
