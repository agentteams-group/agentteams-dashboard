import { describe, expect, it } from 'vitest';
import { workerDisplayName } from './worker-display-name';

describe('workerDisplayName', () => {
  it.each([
    ['# IDENTITY.md\r\n\r\n- **Name:**  月见·研究助手  \r\n- **Vibe:** careful', '月见·研究助手'],
    ['- Name: Research Assistant', 'Research Assistant'],
    ['name: Research Assistant', 'Research Assistant'],
    ['```markdown\n- Name: Example\n```\n- Name: Actual', 'Actual'],
  ])('reads the explicit name field in %j', (identity, displayName) => {
    expect(workerDisplayName({ name: 'agent-123', identity })).toBe(displayName);
  });

  it.each([
    undefined,
    '# IDENTITY.md - Who Am I?\n\n- **Name:**\n  _(pick something you like)_',
    '# An arbitrary heading',
    '- **Name:** _(pick something you like)_',
    '- **Name:**   ',
    '```\n- Name: Only an example\n```',
  ])('uses the stable resource name for %j', (identity) => {
    expect(workerDisplayName({ name: 'agent-123', identity })).toBe('agent-123');
  });
});
