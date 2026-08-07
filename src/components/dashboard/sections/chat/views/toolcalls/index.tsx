import type { ComponentType } from 'react';
import {
  ApplyPatchToolCall,
  ExecuteCommandToolCall,
  FallbackToolCall,
  ListDirectoryToolCall,
  ReadFileToolCall,
  WebSearchToolCall,
  WriteFileToolCall,
} from './tool-call-card';

export interface ToolCallPayload {
  tool_name?: string;
  arguments?: Record<string, unknown> | string;
  args?: Record<string, unknown> | string;
  result?: unknown;
  status?: string;
  isStreaming?: boolean;
  [key: string]: unknown;
}

export type ToolCallRenderer = ComponentType<{ payload: ToolCallPayload }>;

const RENDERERS: Record<string, ToolCallRenderer> = {
  read_file: ReadFileToolCall,
  read: ReadFileToolCall,
  write_file: WriteFileToolCall,
  write: WriteFileToolCall,
  apply_patch: ApplyPatchToolCall,
  applypatch: ApplyPatchToolCall,
  web_search: WebSearchToolCall,
  websearch: WebSearchToolCall,
  execute_command: ExecuteCommandToolCall,
  executecommand: ExecuteCommandToolCall,
  list_directory: ListDirectoryToolCall,
  listdirectory: ListDirectoryToolCall,
};

function normalizeToolName(toolName?: string) {
  return toolName?.replace(/[\s-]/g, '_').toLowerCase();
}

export function resolveToolCallRenderer(payload: ToolCallPayload): ToolCallRenderer {
  return RENDERERS[normalizeToolName(payload.tool_name) || ''] || FallbackToolCall;
}

export function ToolCallView({ payload }: { payload: ToolCallPayload }) {
  const renderer = resolveToolCallRenderer(payload);
  if (renderer === ReadFileToolCall) return <ReadFileToolCall payload={payload} />;
  if (renderer === WriteFileToolCall) return <WriteFileToolCall payload={payload} />;
  if (renderer === ApplyPatchToolCall) return <ApplyPatchToolCall payload={payload} />;
  if (renderer === WebSearchToolCall) return <WebSearchToolCall payload={payload} />;
  if (renderer === ExecuteCommandToolCall) return <ExecuteCommandToolCall payload={payload} />;
  if (renderer === ListDirectoryToolCall) return <ListDirectoryToolCall payload={payload} />;
  return <FallbackToolCall payload={payload} />;
}
