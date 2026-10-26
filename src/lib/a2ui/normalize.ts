/**
 * Unified message normalization entry point.
 *
 * Maps a single Matrix message event to a list of runtime message blocks.
 * Dispatch is strictly priority-ordered (hit-return, single mapping): the
 * first matching rule wins. Rules cover the five supported runtimes:
 *
 *   1. agentteams.workflow key            → workflow block (workflow runtime)
 *   2. org.agentteams.run structured key  → structured blocks (opt-in channel)
 *   3. A2UI protocol markers              → a2ui block (A2UI v0.9 surfaces)
 *   4. Tool Guard approval text           → confirmation block
 *   5. runtime run-ending sentinel        → error block (已取消/处理异常/已处理)
 *   6. agentscope repr dump               → text/thinking/tool_call (copaw)
 *   7. "Thinking:" prefix                 → thinking block (qwenpaw; skipped for copaw)
 *   8. com.agentteams.long_message        → attachment block (long-message fallback)
 *   9. 🔧 **tool** Markdown convention    → tool_call block (Hermes tool calls)
 *  10. tool keyword in agent m.notice     → low-confidence tool_call (hermes/openhuman)
 *  11. agent m.notice process message     → thinking block (Hermes process notices)
 *  12. legacy ```card / <details>         → card/tool_call/thinking (existing)
 *  13. text fallback (Markdown)           → text block
 *
 * Chat file references (`com.agentteams.file_refs`, composer picker) are not
 * a dispatch step: they are appended as an extra `file_refs` block after the
 * selected blocks so a message can carry both body text and refs.
 *
 * `runtime` (resolved from the sender MXID → Worker mapping by the caller)
 * steers rule 7/10 dispatch and is attached to every produced block as
 * `runtimeHint` so renderers can badge the owning runtime.
 */

import type { ParsedA2uiBlock } from './parser';
import { FILE_REFS_CONTENT_KEY, parseFileRefs } from '../file-refs';
import {
  parseA2uiMarkers,
  parseAgentRunBlocks,
  parseEmbeddedAgentReprBlocks,
  parseHermesToolCalls,
  parseLegacyContent,
  parseLongMessage,
  parseRunEnding,
  parseToolGuardConfirmation,
  parseToolKeywordNotice,
} from './parser';
import { isWorkflowPayload } from './workflow';

export interface NormalizeInput {
  body: string;
  formattedBody?: string;
  /** Original event.content (may carry agentteams.workflow, org.agentteams.run...). */
  content: Record<string, unknown>;
  isStreaming: boolean;
  /** Whether the message was sent by the current user (guards notice heuristics). */
  isMine?: boolean;
  /** Runtime owning the sender (from the MXID → Worker lookup), if known. */
  runtime?: string | null;
}

/** qwenpaw on_streaming_end product: "Thinking:\n\n" + thinking text. */
const THINKING_PREFIX = /^Thinking:\s*\n+/;

/** Agent placeholder bodies ("处理中...") stay text until the first revision lands. */
const NOTICE_PLACEHOLDER = /^处理中[.。…]*$/;

/**
 * Upstream F7 appends this literal note (also escaped in formatted_body) to the
 * truncated body. It is bookkeeping for the attachment, not narration.
 */
const LONG_MESSAGE_FOOTER = /\n*\s*<[^<>\n]*(?:已按安全长度截断|truncated)[^<>\n]*>\s*$/i;

/** Whether a body is just the run placeholder (no real content yet). */
export function isAgentPlaceholderBody(body: string | null | undefined): boolean {
  return NOTICE_PLACEHOLDER.test((body ?? '').trim());
}

function stripThinkingPrefix(body: string): string {
  return body.replace(THINKING_PREFIX, '').trim();
}

function stripLongMessageFooter(body: string): string {
  return body.replace(LONG_MESSAGE_FOOTER, '').trim();
}

/** formatted_body carries the same note as one trailing escaped paragraph. */
function stripLongMessageHtmlFooter(html: string): string {
  const marker = html.search(/已按安全长度截断|truncated/i);
  if (marker < 0) return html;
  const start = html.lastIndexOf('<p', marker);
  return (start >= 0 ? html.slice(0, start) : html.slice(0, marker)).trim();
}

function selectBlocks(input: NormalizeInput): ParsedA2uiBlock[] {
  const { body, formattedBody, content, isStreaming, isMine, runtime } = input;

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

  // 5. Runtime run-ending sentinels (copaw/qwenpaw m.replace finals). Guarded
  // to other members' whole-body exact matches so an operator typing "已取消"
  // keeps a plain text bubble.
  if (!isMine) {
    const ending = parseRunEnding(body);
    if (ending) {
      return [{ type: 'error', payload: ending as unknown as Record<string, unknown> }];
    }
  }

  // 6. agentscope-runtime Message repr dump → text/thinking/tool_call (copaw).
  const reprBlocks = parseEmbeddedAgentReprBlocks(body);
  if (reprBlocks) return reprBlocks.blocks;

  // 7. "Thinking:\n\n..." prefix → thinking block (qwenpaw thinking notices).
  // copaw never emits this prefix, so when the runtime is known to be copaw
  // the fallback is skipped (a copaw tool text must not be swallowed here).
  if (runtime !== 'copaw' && THINKING_PREFIX.test(body)) {
    return [{ type: 'thinking', content: stripThinkingPrefix(body), isStreaming }];
  }

  // 8. com.agentteams.long_message → rich narration blocks. The body is the
  // response itself (only truncated for transport); the attachment carries the
  // complete text and is appended by normalizeToBlocks. Parsing the body keeps
  // thinking/tool/A2UI rendering for long messages instead of reducing them to
  // one file card.
  const longMessage = parseLongMessage(content['com.agentteams.long_message']);
  if (longMessage) {
    const narration = stripLongMessageFooter(body);
    if (narration) {
      return parseHermesToolCalls(narration)
        ?? parseLegacyContent(narration).blocks;
    }
    return [{ type: 'attachment', payload: longMessage as unknown as Record<string, unknown> }];
  }

  // 9. Hermes tool-call Markdown convention → tool_call block(s) so the
  // timeline renders a collapsible card instead of a raw code fence.
  const hermesBlocks = parseHermesToolCalls(body);
  if (hermesBlocks) return hermesBlocks;

  // 10. Tool-keyword process notices → low-confidence tool_call card. Runs
  // before the generic notice→thinking fold so hermes/openhuman (and
  // qwenpaw's "tool call" child notices) surface as tool cards.
  if (content.msgtype === 'm.notice' && !isMine) {
    const keywordBlock = parseToolKeywordNotice(body);
    if (keywordBlock) return [keywordBlock];
  }

  // 11. Agent runtime process notices → thinking card. Hermes emits
  // intermediate reasoning steps as m.notice; collapsing them keeps the
  // timeline focused on the final answer. The user's own notices (and run
  // placeholders) stay plain text.
  if (content.msgtype === 'm.notice' && !isMine) {
    const text = body.trim();
    if (text && !isAgentPlaceholderBody(text)) {
      return [{ type: 'thinking', content: text, isStreaming }];
    }
  }

  // 12. legacy ```card / <details> blocks, or
  // 13. plain text fallback (Markdown rendering).
  return parseLegacyContent(body, formattedBody).blocks;
}

export function normalizeToBlocks(input: NormalizeInput): ParsedA2uiBlock[] {
  // Matrix events with m.relates_to (replies / replaces) or structured
  // org.agentteams.run payloads may omit `body`. Callers historically passed
  // that through, and parser matchAll then crashed the chat timeline (#1436).
  const rawBody = typeof input.body === 'string' ? input.body : '';
  const rawFormattedBody = typeof input.formattedBody === 'string' ? input.formattedBody : undefined;
  const longMessage = parseLongMessage(input.content['com.agentteams.long_message']);
  // The F7 truncation note is transport bookkeeping; drop it before dispatch so
  // it never becomes a narration/answer block.
  const body = longMessage ? stripLongMessageFooter(rawBody) : rawBody;
  const formattedBody = longMessage && rawFormattedBody
    ? stripLongMessageHtmlFooter(rawFormattedBody)
    : rawFormattedBody;
  let blocks = selectBlocks({ ...input, body, formattedBody });
  // The attachment is appended outside the dispatch so every long-message path
  // (plain narration, A2UI surfaces, structured runs) keeps the full-text link.
  if (longMessage && !blocks.some((block) => {
    if (block.type !== 'attachment') return false;
    const url = (block.payload as { url?: string } | undefined)?.url;
    return url === longMessage.url;
  })) {
    blocks = [...blocks, { type: 'attachment', payload: longMessage as unknown as Record<string, unknown> }];
  }
  // Chat file references (#87) ride alongside the body text instead of
  // replacing it: the composer may attach files to any message, so the refs
  // are appended as an extra block (ref-only messages render chips alone
  // because empty text blocks are skipped downstream).
  const fileRefs = parseFileRefs(input.content[FILE_REFS_CONTENT_KEY]);
  const withRefs = fileRefs.length > 0
    ? [...blocks, { type: 'file_refs', refs: fileRefs, isStreaming: input.isStreaming } satisfies ParsedA2uiBlock]
    : blocks;
  const hint = input.runtime ?? undefined;
  if (!hint) return withRefs;
  return withRefs.map((block) => (block.runtimeHint ? block : { ...block, runtimeHint: hint }));
}
