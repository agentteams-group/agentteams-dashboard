/**
 * A2UI Protocol Parser for Matrix Messages
 *
 * Extracts A2UI protocol messages from Matrix message content.
 * Supports two embedding formats:
 *
 * 1. HTML comments in formatted_body:
 *    <!--a2ui:{"version":"v0.9","createSurface":{...}}-->
 *
 * 2. Fenced code blocks in plain text body:
 *    ```a2ui
 *    {"version":"v0.9","createSurface":{...}}
 *    ```
 *
 * Also supports legacy custom block formats for backward compatibility:
 *    ```card\n{JSON}\n```
 *    <details class="thinking">...</details>
 */

import type { A2uiMessage } from '@a2ui/web_core/v0_9';
import { tryParseAgentReprBlocks } from './agent-repr';
import type { WorkflowPayload } from './workflow';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParsedA2uiBlock {
  type: 'a2ui' | 'thinking' | 'tool_call' | 'confirmation' | 'workflow' | 'card' | 'text' | 'attachment';
  /** Raw A2UI protocol messages (for 'a2ui' type) */
  messages?: A2uiMessage[];
  /** Content for thinking blocks */
  content?: string;
  /** Payload for card/tool_call blocks */
  payload?: Record<string, unknown>;
  /** Plain text for text blocks */
  text?: string;
  /** Whether this block is still streaming (incomplete) */
  isStreaming?: boolean;
}

/** Payload of an attachment block (upstream F7 long-message fallback). */
export interface AttachmentPayload {
  url: string;
  filename: string;
  mimetype: string;
}

export interface A2uiParseResult {
  blocks: ParsedA2uiBlock[];
  hasA2ui: boolean;
  hasThinking: boolean;
  hasToolCall: boolean;
}

const AGENT_RUN_BLOCK_TYPES = new Set<ParsedA2uiBlock['type']>([
  'a2ui', 'thinking', 'tool_call', 'confirmation', 'workflow', 'card', 'text', 'attachment',
]);

/**
 * Reads an optional structured run payload attached by an AgentTeams runtime
 * adapter. AgentTeams itself does not define this Matrix event schema, so it
 * remains an opt-in compatibility path alongside the runtime repr parser.
 */
export function parseAgentRunBlocks(value: unknown, isStreaming = false): ParsedA2uiBlock[] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const blocks = (value as Record<string, unknown>).blocks;
  if (!Array.isArray(blocks)) return undefined;

  return blocks.flatMap((block): ParsedA2uiBlock[] => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) return [];
    const source = block as Record<string, unknown>;
    const type = source.type;
    if (typeof type !== 'string' || !AGENT_RUN_BLOCK_TYPES.has(type as ParsedA2uiBlock['type'])) return [];

    const parsed: ParsedA2uiBlock = { type: type as ParsedA2uiBlock['type'] };
    if (typeof source.content === 'string') parsed.content = source.content;
    if (typeof source.text === 'string') parsed.text = source.text;
    if (source.payload && typeof source.payload === 'object' && !Array.isArray(source.payload)) {
      parsed.payload = source.payload as Record<string, unknown>;
    }
    if (Array.isArray(source.messages)) parsed.messages = source.messages as A2uiMessage[];
    if (source.isStreaming === true || (isStreaming && type !== 'text')) parsed.isStreaming = true;
    return [parsed];
  });
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

const A2UI_HTML_MARKER = /<!--a2ui:([\s\S]*?)-->/g;
const A2UI_TEXT_MARKER = /```a2ui\n([\s\S]*?)\n```/g;
const AGENT_REPR_START = /(?:sequence_number=\S+\s+)?object='message'\s/g;
const AGENT_REPR_END = 'metadata={}';

/**
 * Parse A2UI protocol messages from Matrix message content.
 * Handles both HTML formatted_body and plain text body.
 *
 * Bodies that contain a dumped agentscope-runtime Message repr (the copaw
 * channel's raw `sequence_number=... object='message' ...` dumps) are parsed
 * first and mapped to text/thinking/tool-call blocks.
 */
export function parseA2uiContent(
  body: string,
  formattedBody?: string,
  workflow?: WorkflowPayload
): A2uiParseResult {
  if (workflow) {
    return {
      blocks: [{ type: 'workflow', payload: workflow }],
      hasA2ui: false,
      hasThinking: false,
      hasToolCall: false,
    };
  }

  // 0. Agent message repr dumps (always in plain body, never formatted_body).
  // Runtime status text and multiple reprs may share a Matrix event body.
  const agentBlocks = parseEmbeddedAgentReprBlocks(body);
  if (agentBlocks) {
    return {
      blocks: agentBlocks.blocks,
      hasA2ui: false,
      hasThinking: agentBlocks.hasThinking,
      hasToolCall: agentBlocks.hasToolCall,
    };
  }

  const confirmation = parseToolGuardConfirmation(body);
  if (confirmation) {
    return {
      blocks: [{ type: 'confirmation', payload: confirmation }],
      hasA2ui: false,
      hasThinking: false,
      hasToolCall: false,
    };
  }

  // 1. A2UI protocol markers (if any), with surrounding non-A2UI text.
  const markerBlocks = parseA2uiMarkers(body, formattedBody);
  if (markerBlocks) {
    return {
      blocks: markerBlocks,
      hasA2ui: true,
      hasThinking: false,
      hasToolCall: false,
    };
  }

  // 2. No A2UI markers found: try legacy format parsing.
  return parseLegacyContent(body, formattedBody);
}

/**
 * Extract A2UI protocol markers from Matrix message content, preserving any
 * surrounding non-A2UI text as text/legacy blocks. Returns null when the
 * body contains no A2UI markers.
 *
 * While streaming (`isStreaming`), an unclosed fence/comment marker produces
 * a placeholder `a2ui` block (rendered as a loading state) instead of falling
 * through to the text fallback, so a half-written payload does not flash as
 * raw text between streaming frames.
 */
export function parseA2uiMarkers(
  body: string,
  formattedBody?: string,
  isStreaming = false
): ParsedA2uiBlock[] | null {
  const content = formattedBody || body;
  const isHtml = !!formattedBody;

  const blocks: ParsedA2uiBlock[] = [];
  let hasA2ui = false;

  const a2uiRegex = isHtml ? A2UI_HTML_MARKER : A2UI_TEXT_MARKER;
  let match: RegExpExecArray | null;
  let lastEnd = 0;

  while ((match = a2uiRegex.exec(content)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    if (start > lastEnd) {
      const textBefore = content.slice(lastEnd, start).trim();
      if (textBefore) {
        blocks.push(...parseNonA2uiBlocks(textBefore, isHtml));
      }
    }

    try {
      const jsonStr = isHtml ? decodeHtmlEntities(match[1]) : match[1];
      const parsed = JSON.parse(jsonStr);
      const messages = Array.isArray(parsed) ? parsed : [parsed];
      blocks.push({ type: 'a2ui', messages });
      hasA2ui = true;
    } catch {
      blocks.push({ type: 'text', text: match[0] });
    }

    lastEnd = end;
  }

  if (!hasA2ui) {
    // Streaming tolerance: an in-progress A2UI marker renders as a loading
    // placeholder rather than the unclosed JSON as raw text. Once streaming
    // ends the marker either parses normally or degrades to text.
    if (isStreaming && hasUnclosedA2uiMarker(content, isHtml)) {
      return [{ type: 'a2ui', isStreaming: true }];
    }
    return null;
  }

  if (lastEnd < content.length) {
    const textAfter = content.slice(lastEnd).trim();
    if (textAfter) {
      blocks.push(...parseNonA2uiBlocks(textAfter, isHtml));
    }
  }

  if (blocks.length === 0) {
    blocks.push({ type: 'text', text: body });
  }

  return blocks;
}

/**
 * Detect a not-yet-closed A2UI marker: an opening ```a2ui fence without a
 * closing fence, or an opening `<!--a2ui:` comment without `-->`.
 */
function hasUnclosedA2uiMarker(content: string, isHtml: boolean): boolean {
  if (isHtml) {
    const start = content.indexOf('<!--a2ui:');
    return start >= 0 && !content.includes('-->', start);
  }
  const fenceIndex = content.indexOf('```a2ui');
  if (fenceIndex < 0) return false;
  const after = content.slice(fenceIndex + '```a2ui'.length);
  return !/```/.test(after);
}

export function parseEmbeddedAgentReprBlocks(body: string): A2uiParseResult | null {
  const blocks: ParsedA2uiBlock[] = [];
  let hasThinking = false;
  let hasToolCall = false;
  let lastEnd = 0;
  let parsedAny = false;

  for (const match of body.matchAll(AGENT_REPR_START)) {
    const start = match.index;
    if (start === undefined) continue;

    const endStart = body.indexOf(AGENT_REPR_END, start);
    if (endStart < 0) continue;

    const end = endStart + AGENT_REPR_END.length;
    const reprBlocks = tryParseAgentReprBlocks(body.slice(start, end));
    if (!reprBlocks) continue;

    const textBefore = body.slice(lastEnd, start).trim();
    if (textBefore) blocks.push({ type: 'text', text: textBefore });
    blocks.push(...reprBlocks.blocks);
    hasThinking ||= reprBlocks.hasThinking;
    hasToolCall ||= reprBlocks.hasToolCall;
    lastEnd = end;
    parsedAny = true;
  }

  if (!parsedAny) return null;

  const textAfter = body.slice(lastEnd).trim();
  if (textAfter) blocks.push({ type: 'text', text: textAfter });

  return { blocks, hasA2ui: false, hasThinking, hasToolCall };
}

/**
 * Recognize the text confirmation prompt emitted by Tool Guard. The runtime
 * consumes `/approve` for approval and treats every other reply as a denial.
 */
export function parseToolGuardConfirmation(body: string): Record<string, unknown> | null {
  if (
    !/Waiting for approval\s*\/\s*等待审批/i.test(body) ||
    !/Type\s+\/approve\s+to approve, or send any message to deny\./i.test(body)
  ) {
    return null;
  }

  const field = (label: string) => {
    const match = body.match(new RegExp(`^${label}:\\s*(.+)$`, 'mi'));
    return match?.[1]?.trim();
  };
  const parameters = body.match(/Parameters\s*\/\s*参数:\s*([\s\S]*?)(?=💡|⚠️|❌|$)/)?.[1]?.trim();
  const externalFiles = body.match(/Files outside workspace:\s*([\s\S]*?)(?=⚠️|❌|$)/)?.[1]?.trim();

  return {
    runtime: 'Tool Guard',
    toolName: field('Tool\\s*\\/\\s*工具') || '未知工具',
    triggeredBy: field('Triggered by\\s*\\/\\s*触发来源'),
    parameters,
    externalFiles,
    approveReply: '/approve',
    rejectReply: '拒绝',
  };
}

/**
 * Parse the upstream F7 long-message fallback metadata. When a reply exceeds
 * the 64KB safety threshold the runtime uploads the full text as a Matrix
 * attachment and tags the event with `com.agentteams.long_message`:
 * `{ version, url: 'mxc://...', filename, mimetype }`.
 */
export function parseLongMessage(value: unknown): AttachmentPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const url = source.url;
  const filename = source.filename;
  const mimetype = source.mimetype;
  if (
    typeof url !== 'string' ||
    typeof filename !== 'string' ||
    typeof mimetype !== 'string'
  ) {
    return null;
  }
  return { url, filename, mimetype };
}

/**
 * Parse legacy custom block formats (```card, <details class="thinking">)
 */
export function parseLegacyContent(
  body: string,
  formattedBody?: string
): A2uiParseResult {
  const blocks: ParsedA2uiBlock[] = [];
  let hasThinking = false;
  let hasToolCall = false;

  const content = formattedBody || body;
  const isHtml = !!formattedBody;

  // Regex to match legacy patterns
  const pattern = /(```card\n([\s\S]*?)\n```|(?:&lt;|<)details\s+class="thinking"(?:&gt;|>)([\s\S]*?)(?:&lt;|<\/)details(?:&gt;|>))/g;
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    // Add text before this match
    if (start > lastEnd) {
      const textBefore = content.slice(lastEnd, start).trim();
      if (textBefore) {
        blocks.push({ type: 'text', text: isHtml ? textBefore : textBefore });
      }
    }

    if (match[2]) {
      // ```card block
      try {
        const payload = JSON.parse(match[2]);
        const isToolCall =
          payload.type === 'tool_call' || payload.tool_name;
        if (isToolCall) {
          blocks.push({ type: 'tool_call', payload });
          hasToolCall = true;
        } else {
          blocks.push({ type: 'card', payload });
        }
      } catch {
        blocks.push({ type: 'text', text: match[2] });
      }
    } else if (match[3]) {
      // <details class="thinking"> block
      const thinkingContent = isHtml
        ? decodeHtmlEntities(match[3])
        : match[3];
      blocks.push({ type: 'thinking', content: thinkingContent });
      hasThinking = true;
    }

    lastEnd = end;
  }

  // Add remaining text
  if (lastEnd < content.length) {
    const textAfter = content.slice(lastEnd).trim();
    if (textAfter) {
      blocks.push({ type: 'text', text: textAfter });
    }
  }

  // If no blocks found, treat entire content as text
  if (blocks.length === 0) {
    blocks.push({ type: 'text', text: body });
  }

  return {
    blocks,
    hasA2ui: false,
    hasThinking,
    hasToolCall,
  };
}

/**
 * Hermes tool-call Markdown convention:
 *
 *   🔧 **tool_name**
 *   ```
 *   {"argument": "value"}
 *   ```
 *
 * The agent runtime posts tool invocations as plain Markdown; without this
 * recognition the timeline renders a raw bold line and a wide code fence.
 */
export function parseHermesToolCalls(body: string): ParsedA2uiBlock[] | null {
  const pattern = /🔧\s*\*\*([^*\n]+)\*\*\s*\n```[^\n]*\n([\s\S]*?)\n```/g;
  const blocks: ParsedA2uiBlock[] = [];
  let lastEnd = 0;
  let matched = false;

  for (const match of body.matchAll(pattern)) {
    matched = true;
    const start = match.index ?? 0;
    const before = body.slice(lastEnd, start).trim();
    if (before) blocks.push({ type: 'text', text: before });

    const toolName = match[1].trim();
    const rawArguments = (match[2] ?? '').trim();
    let argumentsPayload: Record<string, unknown> | string;
    try {
      const parsed = JSON.parse(rawArguments) as unknown;
      argumentsPayload =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : { value: parsed };
    } catch {
      argumentsPayload = rawArguments ? { value: rawArguments } : {};
    }

    blocks.push({
      type: 'tool_call',
      payload: { tool_name: toolName, arguments: argumentsPayload },
    });
    lastEnd = start + match[0].length;
  }

  if (!matched) return null;

  const after = body.slice(lastEnd).trim();
  if (after) blocks.push({ type: 'text', text: after });
  return blocks;
}

/**
 * Parse non-A2UI blocks (thinking, tool_call, text) from a text segment
 */
function parseNonA2uiBlocks(text: string, isHtml: boolean): ParsedA2uiBlock[] {
  const blocks: ParsedA2uiBlock[] = [];
  const pattern = /(```card\n([\s\S]*?)\n```|(?:&lt;|<)details\s+class="thinking"(?:&gt;|>)([\s\S]*?)(?:&lt;|<\/)details(?:&gt;|>))/g;
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    if (start > lastEnd) {
      const textBefore = text.slice(lastEnd, start).trim();
      if (textBefore) {
        blocks.push({ type: 'text', text: textBefore });
      }
    }

    if (match[2]) {
      try {
        const payload = JSON.parse(match[2]);
        blocks.push({
          type: payload.type === 'tool_call' || payload.tool_name ? 'tool_call' : 'card',
          payload,
        });
      } catch {
        blocks.push({ type: 'text', text: match[2] });
      }
    } else if (match[3]) {
      blocks.push({
        type: 'thinking',
        content: isHtml ? decodeHtmlEntities(match[3]) : match[3],
      });
    }

    lastEnd = end;
  }

  if (lastEnd < text.length) {
    const remaining = text.slice(lastEnd).trim();
    if (remaining) {
      blocks.push({ type: 'text', text: remaining });
    }
  }

  return blocks;
}

/**
 * Decode HTML entities in A2UI markers
 */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

