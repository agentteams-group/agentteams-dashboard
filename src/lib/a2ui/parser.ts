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

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParsedA2uiBlock {
  type: 'a2ui' | 'thinking' | 'tool_call' | 'card' | 'text';
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

export interface A2uiParseResult {
  blocks: ParsedA2uiBlock[];
  hasA2ui: boolean;
  hasThinking: boolean;
  hasToolCall: boolean;
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

const A2UI_HTML_MARKER = /<!--a2ui:([\s\S]*?)-->/g;
const A2UI_TEXT_MARKER = /```a2ui\n([\s\S]*?)\n```/g;
const LEGACY_CARD_MARKER = /```card\n([\s\S]*?)\n```/g;
const LEGACY_THINKING_MARKER = /(?:&lt;|<)details\s+class="thinking"(?:&gt;|>)([\s\S]*?)(?:&lt;|<\/)details(?:&gt;|>)/g;

/**
 * Parse A2UI protocol messages from Matrix message content.
 * Handles both HTML formatted_body and plain text body.
 */
export function parseA2uiContent(
  body: string,
  formattedBody?: string
): A2uiParseResult {
  const blocks: ParsedA2uiBlock[] = [];
  let hasA2ui = false;
  let hasThinking = false;
  let hasToolCall = false;

  // Prefer formatted_body if available (HTML)
  const content = formattedBody || body;
  const isHtml = !!formattedBody;

  // Track consumed ranges to avoid double-parsing
  const consumed: [number, number][] = [];
  let lastEnd = 0;

  // 1. Extract A2UI protocol markers
  const a2uiRegex = isHtml ? A2UI_HTML_MARKER : A2UI_TEXT_MARKER;
  let match: RegExpExecArray | null;

  while ((match = a2uiRegex.exec(content)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    // Add text before this marker
    if (start > lastEnd) {
      const textBefore = content.slice(lastEnd, start).trim();
      if (textBefore) {
        blocks.push(...parseNonA2uiBlocks(textBefore, isHtml));
      }
    }

    // Parse the A2UI JSON
    try {
      const jsonStr = isHtml ? decodeHtmlEntities(match[1]) : match[1];
      const parsed = JSON.parse(jsonStr);

      // Handle array of messages or single message
      const messages = Array.isArray(parsed) ? parsed : [parsed];
      blocks.push({ type: 'a2ui', messages });
      hasA2ui = true;
    } catch {
      // Invalid JSON, treat as text
      blocks.push({ type: 'text', text: match[0] });
    }

    consumed.push([start, end]);
    lastEnd = end;
  }

  // 2. If no A2UI markers found, try legacy format parsing
  if (!hasA2ui) {
    return parseLegacyContent(body, formattedBody);
  }

  // 3. Add remaining text after last marker
  if (lastEnd < content.length) {
    const textAfter = content.slice(lastEnd).trim();
    if (textAfter) {
      blocks.push(...parseNonA2uiBlocks(textAfter, isHtml));
    }
  }

  // If no blocks found, treat entire content as text
  if (blocks.length === 0) {
    blocks.push({ type: 'text', text: body });
  }

  return { blocks, hasA2ui, hasThinking, hasToolCall };
}

/**
 * Parse legacy custom block formats (```card, <details class="thinking">)
 */
function parseLegacyContent(
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

/**
 * Convert legacy card/tool_call payload to A2UI protocol messages
 */
export function legacyToA2uiMessages(
  payload: Record<string, unknown>,
  surfaceId: string,
  isToolCall: boolean
): A2uiMessage[] {
  if (isToolCall) {
    return [
      {
        version: 'v0.9' as const,
        createSurface: { surfaceId, catalogId: 'hiclaw-chat' },
      },
      {
        version: 'v0.9' as const,
        updateComponents: {
          surfaceId,
          components: [
            {
              id: 'root',
              component: 'ToolCallBlock',
              toolName: payload.tool_name || payload.name || '工具调用',
              arguments: payload.arguments || payload.args,
              result: payload.result,
              status: payload.status || (payload.error ? 'error' : 'success'),
              isStreaming: payload.isStreaming || false,
            },
          ],
        },
      },
    ] as unknown as A2uiMessage[];
  }

  return [
    {
      version: 'v0.9' as const,
      createSurface: { surfaceId, catalogId: 'hiclaw-chat' },
    },
    {
      version: 'v0.9' as const,
      updateComponents: {
        surfaceId,
        components: [
          {
            id: 'root',
            component: 'Column',
            children: ['title', 'content'],
          },
          {
            id: 'title',
            component: 'Text',
            text: payload.title || '卡片',
            variant: 'h4',
          },
          {
            id: 'content',
            component: 'MarkdownBlock',
            content: typeof payload.content === 'string'
              ? payload.content
              : JSON.stringify(payload, null, 2),
          },
        ],
      },
    },
  ] as unknown as A2uiMessage[];
}

/**
 * Convert legacy thinking content to A2UI protocol messages
 */
export function thinkingToA2uiMessages(
  content: string,
  surfaceId: string,
  isStreaming = false
): A2uiMessage[] {
  return [
    {
      version: 'v0.9' as const,
      createSurface: { surfaceId, catalogId: 'hiclaw-chat' },
    },
    {
      version: 'v0.9' as const,
      updateComponents: {
        surfaceId,
        components: [
          {
            id: 'root',
            component: 'ThinkingBlock',
            content,
            title: '思考过程',
            isStreaming,
          },
        ],
      },
    },
  ] as unknown as A2uiMessage[];
}
