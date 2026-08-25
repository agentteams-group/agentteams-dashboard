import { describe, expect, it } from 'vitest';
import { parseAgentRunBlocks } from './parser';

describe('parseAgentRunBlocks v1', () => {
  it('parses a v1 envelope with text + thinking blocks', () => {
    const blocks = parseAgentRunBlocks({
      version: '1',
      run_id: 'run-1',
      step_id: 'step-1',
      blocks: [
        { type: 'thinking', content: '思考中' },
        { type: 'text', text: '最终回答' },
      ],
    });
    expect(blocks).toHaveLength(2);
    expect(blocks?.[0]).toMatchObject({ type: 'thinking', content: '思考中' });
    expect(blocks?.[1]).toMatchObject({ type: 'text', text: '最终回答' });
  });

  it('normalises tool_call v1 blocks with stable id and status defaults', () => {
    const blocks = parseAgentRunBlocks({
      version: '1',
      blocks: [{ type: 'tool_call', tool_name: 'search', arguments: { q: 'test' } }],
    });
    expect(blocks).toHaveLength(1);
    const payload = blocks?.[0].payload as { tool_name: string; arguments: Record<string, unknown>; status: string; tool_call_id?: string };
    expect(payload.tool_name).toBe('search');
    expect(payload.arguments).toEqual({ q: 'test' });
    expect(payload.status).toBe('running');
    expect(payload.tool_call_id).toBeUndefined();
  });

  it('preserves tool_call_id when the runtime provides one', () => {
    const blocks = parseAgentRunBlocks({
      version: '1',
      blocks: [{ type: 'tool_call', tool_name: 'read_file', arguments: {}, tool_call_id: 'call-42', status: 'succeeded' }],
    });
    const payload = blocks?.[0].payload as { tool_call_id?: string; status: string };
    expect(payload.tool_call_id).toBe('call-42');
    expect(payload.status).toBe('succeeded');
  });

  it('drops tool_call blocks that lack a tool_name', () => {
    const blocks = parseAgentRunBlocks({
      version: '1',
      blocks: [{ type: 'tool_call', arguments: {} }],
    });
    expect(blocks).toBeUndefined();
  });

  it('drops confirmation blocks that lack confirmation_id', () => {
    const blocks = parseAgentRunBlocks({
      version: '1',
      blocks: [{ type: 'confirmation', tool_name: 'bash', parameters: 'ls' }],
    });
    expect(blocks).toBeUndefined();
  });

  it('passes through confirmation blocks with confirmation_id', () => {
    const blocks = parseAgentRunBlocks({
      version: '1',
      blocks: [{ type: 'confirmation', tool_name: 'bash', confirmation_id: 'cfm-1' }],
    });
    expect(blocks?.[0].type).toBe('confirmation');
    const payload = blocks?.[0].payload as { tool_name: string; confirmation_id: string };
    expect(payload.confirmation_id).toBe('cfm-1');
  });

  it('normalises error blocks to the recognised kinds', () => {
    const blocks = parseAgentRunBlocks({
      version: '1',
      blocks: [
        { type: 'error', kind: 'cancelled', title: '已取消' },
        { type: 'error', kind: 'unknown', title: 'whatever' },
      ],
    });
    expect(blocks).toHaveLength(1);
    expect(blocks?.[0]).toMatchObject({ type: 'error' });
    expect((blocks?.[0].payload as { kind: string }).kind).toBe('cancelled');
  });

  it('skips unknown block types silently', () => {
    const blocks = parseAgentRunBlocks({
      version: '1',
      blocks: [
        { type: 'something_new', foo: 1 },
        { type: 'text', text: 'hi' },
      ],
    });
    expect(blocks).toHaveLength(1);
    expect(blocks?.[0].type).toBe('text');
  });

  it('returns undefined for unknown protocol versions', () => {
    const blocks = parseAgentRunBlocks({
      version: '9',
      blocks: [{ type: 'text', text: 'hi' }],
    });
    expect(blocks).toBeUndefined();
  });

  it('returns undefined when v1 blocks array is missing', () => {
    expect(parseAgentRunBlocks({ version: '1' })).toBeUndefined();
    expect(parseAgentRunBlocks({ version: '1', blocks: 'nope' })).toBeUndefined();
  });
});

describe('parseAgentRunBlocks legacy (v0 / unspecified)', () => {
  it('still maps every recognised block type with declared fields', () => {
    const blocks = parseAgentRunBlocks({
      blocks: [
        { type: 'thinking', content: '分析中' },
        { type: 'text', text: '分析结果' },
      ],
    });
    expect(blocks).toHaveLength(2);
    expect(blocks?.[0]).toMatchObject({ type: 'thinking', content: '分析中' });
    expect(blocks?.[1]).toMatchObject({ type: 'text', text: '分析结果' });
  });

  it('treats explicit version "0" as legacy', () => {
    const blocks = parseAgentRunBlocks({
      version: '0',
      blocks: [{ type: 'text', text: 'legacy' }],
    });
    expect(blocks?.[0]).toMatchObject({ type: 'text', text: 'legacy' });
  });
});