/**
 * Unified message normalization entry point.
 *
 * Maps a single Matrix message event to a list of runtime message blocks.
 * Dispatch is strictly priority-ordered (hit-return, single mapping): the
 * first matching rule wins. Rules cover the four supported runtimes:
 *
 *   1. agentteams.workflow key            → workflow block (workflow runtime)
 *   2. org.agentteams.run structured key  → structured blocks (opt-in channel)
 *   3. A2UI protocol markers              → a2ui block (A2UI v0.9 surfaces)
 *   4. Tool Guard approval text           → confirmation block
 *   5. agentscope repr dump               → text/thinking/tool_call (copaw)
 *   6. "Thinking:" prefix                 → thinking block (qwenpaw)
 *   7. com.agentteams.long_message        → attachment block (long-message fallback)
 *   8. legacy ```card / <details>         → card/tool_call/thinking (existing)
 *   9. text fallback (Markdown)           → text block
 */

import type { ParsedA2uiBlock } from './parser';
import {
  parseA2uiMarkers,
  parseAgentRunBlocks,
  parseEmbeddedAgentReprBlocks,
  parseLegacyContent,
  parseLongMessage,
  parseToolGuardConfirmation,
} from './parser';
import { isWorkflowPayload } from './workflow';

export interface NormalizeInput {
  body: string;
  formattedBody?: string;
  /** Original event.content (may carry agentteams.workflow, org.agentteams.run...). */
  content: Record<string, unknown>;
  isStreaming: boolean;
}

/** qwenpaw on_streaming_end product: "Thinking:\n\n" + thinking text. */
const THINKING_PREFIX = /^Thinking:\s*\n+/;

function stripThinkingPrefix(body: string): string {
  return body.replace(THINKING_PREFIX, '').trim();
}

export function normalizeToBlocks(input: NormalizeInput): ParsedA2uiBlock[] {
  const { body, formattedBody, content, isStreaming } = input;

  // 1. agentteams.workflow → workflow block (highest priority).
  if (isWorkflowPayload(content['agentteams.workflow'])) {
    return [{ type: 'workflow', payload: content['agentteams.workflow'] }];
  }

  // 2. org.agentteams.run → structured block channel (opt-in; upstream has no
  // producer yet, kept as a forward-compatible path).
  const runBlocks = parseAgentRunBlocks(content['org.agentteams.run'], isStreaming);
  if (runBlocks) return runBlocks;

  // 3. A2UI protocol markers → a2ui block(s). Unclosed markers render as a
  // loading placeholder while streaming (see parseA2uiMarkers).
  const markerBlocks = parseA2uiMarkers(body, formattedBody, isStreaming);
  if (markerBlocks) return markerBlocks;

  // 4. Tool Guard approval text → confirmation block.
  const confirmation = parseToolGuardConfirmation(body);
  if (confirmation) return [{ type: 'confirmation', payload: confirmation }];

  // 5. agentscope-runtime Message repr dump → text/thinking/tool_call (copaw).
  const reprBlocks = parseEmbeddedAgentReprBlocks(body);
  if (reprBlocks) return reprBlocks.blocks;

  // 6. "Thinking:\n\n..." prefix → thinking block (qwenpaw thinking notices).
  if (THINKING_PREFIX.test(body)) {
    return [{ type: 'thinking', content: stripThinkingPrefix(body), isStreaming }];
  }

  // 7. com.agentteams.long_message → attachment block (upstream F7
  // long-message fallback: body truncated, full text uploaded as attachment).
  const longMessage = parseLongMessage(content['com.agentteams.long_message']);
  if (longMessage) {
    return [{ type: 'attachment', payload: longMessage as unknown as Record<string, unknown> }];
  }

  // 8. legacy ```card / <details class="thinking"> blocks, or
  // 9. plain text fallback (Markdown rendering).
  return parseLegacyContent(body, formattedBody).blocks;
}
