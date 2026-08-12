import type { ComponentType } from 'react';
import {
  ApplyPatchToolCall,
  ExecuteCommandToolCall,
  FallbackToolCall,
  ListDirectoryToolCall,
  ReadFileToolCall,
  WebSearchToolCall,
  WriteFileToolCall,
  type ToolRendererProps,
} from './tool-call-card';

export interface ToolCallPayload {
  tool_name?: string;
  arguments?: Record<string, unknown> | string;
  args?: Record<string, unknown> | string;
  result?: unknown;
  status?: string;
  isStreaming?: boolean;
  /** 'low' = heuristically recognized from a plain notice (no structured protocol). */
  confidence?: string;
  /** Original notice text for heuristic recognitions. */
  note?: string;
  [key: string]: unknown;
}

export type ToolCallRenderer = ComponentType<ToolRendererProps>;

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

export function ToolCallView({
  payload,
  runtime,
  eventId,
  revisionCount,
}: {
  payload: ToolCallPayload;
  /** Runtime that produced this tool call (drives the corner badge). */
  runtime?: string | null;
  /** Root Matrix event id, shown when the card is expanded. */
  eventId?: string;
  /** Number of m.replace revisions merged into the message. */
  revisionCount?: number;
}) {
  const renderer = resolveToolCallRenderer(payload);
  const props: ToolRendererProps = { payload, runtime, eventId, revisionCount };
  if (renderer === ReadFileToolCall) return <ReadFileToolCall {...props} />;
  if (renderer === WriteFileToolCall) return <WriteFileToolCall {...props} />;
  if (renderer === ApplyPatchToolCall) return <ApplyPatchToolCall {...props} />;
  if (renderer === WebSearchToolCall) return <WebSearchToolCall {...props} />;
  if (renderer === ExecuteCommandToolCall) return <ExecuteCommandToolCall {...props} />;
  if (renderer === ListDirectoryToolCall) return <ListDirectoryToolCall {...props} />;
  return <FallbackToolCall {...props} />;
}
