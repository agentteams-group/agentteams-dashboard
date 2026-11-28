// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MERMAID_LIMITS, validateMermaidBounds } from './mermaid-limits';

describe('validateMermaidBounds', () => {
  it('accepts a small valid chart', () => {
    expect(validateMermaidBounds('flowchart TD\nA[Start] --> B[Done]')).toEqual({ ok: true });
  });

  it('rejects charts above the character budget', () => {
    expect(validateMermaidBounds('x'.repeat(MERMAID_LIMITS.characters + 1))).toEqual({
      ok: false,
      reason: expect.stringContaining('字符上限'),
    });
  });

  it('rejects charts above the edge budget', () => {
    const chart = Array.from({ length: MERMAID_LIMITS.edges + 1 }, (_, index) => `a${index} --> b${index}`).join('\n');
    expect(validateMermaidBounds(chart)).toEqual({ ok: false, reason: expect.stringContaining('连线上限') });
  });

  it('rejects charts above the node budget', () => {
    const chart = ['flowchart TD', ...Array.from({ length: MERMAID_LIMITS.nodes + 1 }, (_, index) => `n${index}`)].join('\n');
    expect(validateMermaidBounds(chart)).toEqual({ ok: false, reason: expect.stringContaining('节点上限') });
  });
});
