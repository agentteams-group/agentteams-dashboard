import { describe, expect, it } from 'vitest';
import { parseA2uiContent } from './parser';
import { normalizeToBlocks } from './normalize';
import { extractConfirmationFromEvent } from '@/lib/hitl-inbox';

describe('Team Admin dropdown request', () => {
  it('preserves surrounding text and stable Human identities', () => {
    const request = { confirmation_id: 'admin-alpha-1', question: '选择管理员', options: [{ id: 'alice', label: 'Alice（alice）' }] };
    const parsed = parseA2uiContent(`Before\n\n\`\`\`team-admin\n${JSON.stringify(request)}\n\`\`\`\nAfter`);
    expect(parsed.blocks.map((block) => block.type)).toEqual(['text', 'confirmation', 'text']);
    expect(parsed.blocks[1].payload).toMatchObject({ ...request, tool_name: 'select_team_admin' });
    const body = `\`\`\`team-admin\n${JSON.stringify(request)}\n\`\`\``;
    expect(normalizeToBlocks({ body, content: {}, isStreaming: false })[0].type).toBe('confirmation');
    expect(extractConfirmationFromEvent({ type: 'm.room.message', event_id: '$selection', sender: '@manager:test', origin_server_ts: Date.now(), content: { body } }, '!room:test')?.id).toBe(request.confirmation_id);
  });
  it('keeps malformed or empty candidate requests visible as text', () => {
    for (const value of ['invalid', JSON.stringify({ confirmation_id: 'x', question: 'Q', options: [] })]) {
      const result = parseA2uiContent(`\`\`\`team-admin\n${value}\n\`\`\``);
      expect(result.blocks.some((block) => block.type === 'confirmation')).toBe(false);
      expect(result.blocks.some((block) => block.type === 'text')).toBe(true);
    }
  });
});
