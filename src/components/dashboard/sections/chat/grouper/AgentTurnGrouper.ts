import { isAgentPlaceholderBody, normalizeToBlocks } from '@/lib/a2ui/normalize';
import type { ParsedA2uiBlock } from '@/lib/a2ui/parser';
import { parseWorkerLifecycleNotice } from '@/lib/chat-lifecycle-notice';
import type { DisplayMessage } from '@/hooks/use-matrix';

/**
 * Workers (Hermes/QwenPaw especially) stream a single turn as many Matrix
 * messages: a "处理中..." placeholder, one m.notice per reasoning step, one
 * m.text per tool call, then the final answer. Rendered one message at a time
 * the turn becomes a column of disconnected bubbles, each with its own avatar
 * and "过程" disclosure — the segmented look reported for long answers.
 *
 * This grouper folds a worker turn into one display message: one avatar, one
 * process disclosure carrying every thinking/tool block in order, then the
 * text output. A turn ends when the sender changes, the conversation lane
 * changes (root vs thread), or the gap grows past a long tool run.
 */

/** A single tool run can pause for minutes between steps; a human reply ends it. */
const TURN_MAX_GAP_MS = 10 * 60 * 1000;

/** Blocks that are safe to fold into a turn without losing interactivity. */
const FOLDABLE_BLOCK_TYPES: ReadonlySet<ParsedA2uiBlock['type']> = new Set([
  'thinking',
  'tool_call',
  'text',
]);

function isProcessBlock(block: ParsedA2uiBlock): boolean {
  return block.type === 'thinking' || block.type === 'tool_call';
}

function sameConversationLane(anchor: DisplayMessage, candidate: DisplayMessage): boolean {
  // The placeholder root is not itself a thread reply, but the worker answers
  // by replying inside its own thread (Hermes). Those replies belong to the
  // turn opened by the root, not to a different conversation.
  if (candidate.isThreadReply) {
    return anchor.threadId
      ? candidate.threadId === anchor.threadId
      : candidate.threadId === anchor.id;
  }
  // The root can also arrive last when the final answer edits an early
  // placeholder (qwenpaw m.replace): the run starts with the root's thread
  // replies and ends with the root itself.
  if (anchor.threadId && candidate.id === anchor.threadId) return true;
  if (!anchor.isThreadReply && !anchor.threadId && candidate.id !== anchor.id) {
    // Hermes/openhuman stream process notices as top-level events, so a fresh
    // top-level message can still belong to the current run. Two shapes end it:
    if (isAgentPlaceholderBody(candidate.content)) return false;
    // The anchor already delivered its answer (qwenpaw edits the placeholder
    // root). A different top-level event is the next run, not more output.
    if ((anchor.revisionCount ?? 0) > 0) return false;
    return true;
  }
  return !anchor.isThreadReply && candidate.threadId === anchor.threadId;
}

function turnBlocksOf(message: DisplayMessage): ParsedA2uiBlock[] | null {
  // ChatIR already assembled this turn; folding it again would nest the
  // precomputed blocks and re-split a finished answer.
  if (message.turnId) return null;
  if (message.precomputedBlocks) return null;
  if (message.isMe || !message.workerName) return null;
  if (message.workflow) return null;
  if (message.mediaUrl) return null;
  if (message.fileRefs && message.fileRefs.length > 0) return null;
  if (message.type !== 'm.text' && message.type !== 'm.notice') return null;
  // Lifecycle announcements render as a dedicated status row, not as a turn.
  if (parseWorkerLifecycleNotice(message.content)) return null;

  const blocks = normalizeToBlocks({
    body: typeof message.content === 'string' ? message.content : '',
    formattedBody: typeof message.formattedContent === 'string' ? message.formattedContent : undefined,
    content: message.rawContent ?? {},
    isStreaming: !!message.isStreaming,
    isMine: message.isMe,
    runtime: message.runtime ?? null,
  });

  // Confirmation cards, workflow cards, media attachments and file-refs keep
  // their own tile so their actions still target the originating event.
  if (blocks.length === 0) return null;
  return blocks.every((block) => FOLDABLE_BLOCK_TYPES.has(block.type)) ? blocks : null;
}

interface TurnEntry {
  message: DisplayMessage;
  blocks: ParsedA2uiBlock[];
}

function buildTurnMessage(entries: TurnEntry[]): DisplayMessage {
  const first = entries[0].message;
  const last = entries[entries.length - 1].message;
  // When the answer is an edit of the placeholder root, that root sorts after
  // its thread replies; keep it as the canonical event for replies/threads.
  const laneRoot = first.threadId
    ? entries.map((entry) => entry.message).find((message) => message.id === first.threadId)
    : undefined;
  const canonical = laneRoot ?? first;

  const processBlocks: ParsedA2uiBlock[] = [];
  const outputBlocks: ParsedA2uiBlock[] = [];
  for (const entry of entries) {
    for (const block of entry.blocks) {
      // The placeholder carries no content; drop it so the turn starts with
      // the process disclosure instead of an empty "处理中..." bubble.
      if (block.type === 'text' && isAgentPlaceholderBody(block.text)) continue;
      (isProcessBlock(block) ? processBlocks : outputBlocks).push(block);
    }
  }

  const textContent = outputBlocks
    .filter((block): block is ParsedA2uiBlock & { text: string } =>
      block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n\n')
    .trim();

  // The remaining content blocks are all text (see FOLDABLE_BLOCK_TYPES), so
  // render them as one continuous answer instead of one bubble per streamed
  // message. Step commentary and the final answer keep their order.
  const renderedBlocks: ParsedA2uiBlock[] = textContent
    ? [
        ...processBlocks,
        {
          type: 'text',
          text: textContent,
          isStreaming: outputBlocks.some((block) => block.isStreaming === true) || undefined,
        },
      ]
    : processBlocks;

  const sourceEventIds = [...new Set(
    entries
      .flatMap((entry) => [
        entry.message.id,
        entry.message.eventId,
        ...(entry.message.sourceEventIds ?? []),
      ])
      .filter((id): id is string => Boolean(id)),
  )];

  return {
    ...first,
    // The root event stays canonical for replies, read markers and the thread
    // panel; the folded event ids are matched separately by the timeline.
    id: canonical.id,
    eventId: canonical.eventId ?? canonical.id,
    type: 'm.text',
    content: textContent,
    formattedContent: undefined,
    timestamp: last.timestamp,
    isStreaming: entries.some((entry) => entry.message.isStreaming) ||
      processBlocks.some((block) => block.isStreaming === true),
    agentStatus: [...entries].reverse().find((entry) => entry.message.agentStatus)?.message.agentStatus,
    isEdited: last.isEdited,
    revisionCount: last.revisionCount,
    precomputedBlocks: renderedBlocks,
    sourceEventIds,
  };
}

export function coalesceWorkerTurns(messages: DisplayMessage[]): DisplayMessage[] {
  const result: DisplayMessage[] = [];
  let index = 0;

  while (index < messages.length) {
    const anchor = messages[index];
    const anchorBlocks = turnBlocksOf(anchor);
    if (!anchorBlocks) {
      result.push(anchor);
      index += 1;
      continue;
    }

    const entries: TurnEntry[] = [{ message: anchor, blocks: anchorBlocks }];
    let cursor = index + 1;
    while (cursor < messages.length) {
      const candidate = messages[cursor];
      const previous = entries[entries.length - 1].message;
      if (candidate.sender !== anchor.sender) break;
      if (!sameConversationLane(anchor, candidate)) break;
      if (candidate.timestamp - previous.timestamp > TURN_MAX_GAP_MS) break;
      const blocks = turnBlocksOf(candidate);
      if (!blocks) break;
      entries.push({ message: candidate, blocks });
      cursor += 1;
    }

    const hasProcess = entries.some((entry) => entry.blocks.some(isProcessBlock));
    if (entries.length === 1 || !hasProcess) {
      // Text-only sequences keep their individual bubbles; the wins here come
      // from folding process steps, not from re-bubbling plain answers.
      for (const entry of entries) result.push(entry.message);
    } else {
      result.push(buildTurnMessage(entries));
    }
    index = cursor;
  }

  return result;
}
