import { describe, expect, it } from 'vitest';
import {
  ApplyPatchToolCall,
  FallbackToolCall,
  ReadFileToolCall,
} from './tool-call-card';
import { resolveToolCallRenderer } from './index';

describe('resolveToolCallRenderer', () => {
  it('selects the read file renderer for supported name variants', () => {
    expect(resolveToolCallRenderer({ tool_name: 'read_file' })).toBe(ReadFileToolCall);
    expect(resolveToolCallRenderer({ tool_name: 'Read' })).toBe(ReadFileToolCall);
  });

  it('selects the patch renderer for camel-case tool names', () => {
    expect(resolveToolCallRenderer({ tool_name: 'ApplyPatch' })).toBe(ApplyPatchToolCall);
  });

  it('uses the fallback renderer for unknown tools', () => {
    expect(resolveToolCallRenderer({ tool_name: 'unknown_tool' })).toBe(FallbackToolCall);
  });
});
