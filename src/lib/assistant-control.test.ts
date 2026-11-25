import { describe, expect, it } from 'vitest';
import { isAssistantControlEvent } from './assistant-control';

describe('assistant control carrier', () => {
  const content = { msgtype: 'm.notice', 'org.agentteams.coordination': {
    channel_meta: { sender_id: '@leader:test', agent_matrix_user_id: '@leader:test',
      teamharness_coordination: { kind: 'assistant_digest' } },
  } };
  it('identifies the self-addressed background wake only', () => {
    expect(isAssistantControlEvent({ type: 'm.room.message', sender: '@leader:test', content })).toBe(true);
    expect(isAssistantControlEvent({ type: 'm.room.message', sender: '@human:test', content })).toBe(false);
    expect(isAssistantControlEvent({ type: 'm.room.message', sender: '@leader:test', content: { msgtype: 'm.notice', body: 'ordinary notice' } })).toBe(false);
    expect(isAssistantControlEvent({ type: 'm.room.message', sender: '@leader:test', content: { msgtype: 'm.text', 'org.agentteams.assistant_reminder': { recipient: '@human:test' } } })).toBe(false);
  });
});
