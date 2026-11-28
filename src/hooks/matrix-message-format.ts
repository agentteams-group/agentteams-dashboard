import type { MatrixEvent } from '@/lib/matrix-api';
import { isWorkflowPayload } from '@/lib/a2ui/workflow';
import { parseAgentRunBlocks } from '@/lib/a2ui/parser';
import { READ_AUDIENCE_KEY } from '@/lib/message-read-status';
import { isAssistantControlEvent } from '@/lib/assistant-control';
import type { DisplayMessage } from './use-matrix';

function normalizeMatrixMessageBody(body: unknown): string {
  if (typeof body === 'string') return body;

  if (Array.isArray(body)) {
    return body
      .map(normalizeMatrixMessageBody)
      .filter(Boolean)
      .join('\n');
  }

  if (body && typeof body === 'object') {
    const text = (body as Record<string, unknown>).text;
    if (typeof text === 'string') return text;
    return JSON.stringify(body) ?? '';
  }

  if (typeof body === 'number' || typeof body === 'boolean') return String(body);

  return '';
}

export function formatMatrixEvent(event: MatrixEvent, currentUserId: string): DisplayMessage | null {
  // Only display message events
  if (event.type !== 'm.room.message') return null;

  const senderShort = event.sender.startsWith('@')
    ? event.sender.split(':')[0].slice(1)
    : event.sender;

  // Redacted (deleted) messages have their content wiped by the homeserver;
  // treat them as gone so the timeline drops them instead of showing blanks.
  const rawContent = (event.content ?? {}) as MatrixEvent['content'];
  if (
    !rawContent.msgtype &&
    !rawContent.body &&
    !rawContent['m.relates_to']
  ) {
    return null;
  }

  // Edited messages (m.replace): render the replacement content instead of
  // the stale fallback body ("* ..."). The manager delivers final answers by
  // editing its "处理中..." placeholder, so without this the room shows the
  // edit fallback as a separate, ugly message.
  let content = rawContent;
  const relatesTo = content['m.relates_to'] as { rel_type?: string } | undefined;
  const isEdited = relatesTo?.rel_type === 'm.replace';
  if (isEdited) {
    const newContent = content['m.new_content'] as typeof content | undefined;
    if (newContent && typeof newContent === 'object') {
      content = { ...content, ...newContent };
    }
  }

  // Scheduled/Task wakeups are input for the runtime, not unanswered turns.
  const coordination = content['org.agentteams.coordination'] as {
    channel_meta?: { sender_id?: string; agent_matrix_user_id?: string;
      teamharness_coordination?: { kind?: string } };
  } | undefined;
  const control = coordination?.channel_meta;
  if (content.msgtype === 'm.notice'
    && ['assistant_digest', 'handoff'].includes(control?.teamharness_coordination?.kind ?? '')
    && control?.sender_id === event.sender
    && control?.agent_matrix_user_id === event.sender) return null;

  // A thread reply carries an m.thread relation pointing at the thread root.
  const threadRelation = content['m.relates_to'] as {
    rel_type?: string; event_id?: string; is_falling_back?: boolean; 'm.in_reply_to'?: { event_id?: string };
  } | undefined;
  const isThreadReply = threadRelation?.rel_type === 'm.thread';
  const threadRootId = isThreadReply ? threadRelation?.event_id : undefined;
  const target = threadRelation?.['m.in_reply_to']?.event_id;
  const replyToEventId = typeof target === 'string' && target.startsWith('$') &&
    (!isThreadReply || !threadRelation?.is_falling_back) ? target : undefined;
  const body = normalizeMatrixMessageBody(content.body);
  const replyBody = replyToEventId && body.startsWith('> <@') ? body.replace(/^(?:> [^\r\n]*\r?\n)+\r?\n/, '') : body;
  const formattedBody = replyToEventId ? content.formatted_body?.replace(/^<mx-reply>[\s\S]*?<\/mx-reply>\s*/i, '') : content.formatted_body;

  const isStreaming = isMatrixStreaming(content);
  return {
    id: event.event_id,
    sender: event.sender,
    senderShort,
    content: replyBody,
    formattedContent: formattedBody,
    timestamp: event.origin_server_ts,
    type: content.msgtype || 'm.text',
    isMe: event.sender === currentUserId,
    mediaUrl: content.url as string | undefined,
    mediaInfo: content.info as { mimetype?: string; size?: number; w?: number; h?: number } | undefined,
    isStreaming,
    agentStatus: isMatrixAgentStatus(content),
    workflow: isWorkflowPayload(content['agentteams.workflow'])
      ? content['agentteams.workflow']
      : undefined,
    agentBlocks: parseAgentRunBlocks(content['org.agentteams.run'], isStreaming),
    rawContent: replyToEventId ? { ...content, body: replyBody, formatted_body: formattedBody } : content as Record<string, unknown>,
    isEdited,
    eventId: event.event_id,
    canonicalEventId: threadRootId ?? event.event_id,
    latestEventId: event.event_id,
    runId: readAgentRunId(content),
    threadId: isThreadReply ? threadRootId : undefined,
    isThreadReply,
    replyToEventId,
  };
}

/** org.agentteams.run.run_id (structured adapter) or a flat run id field. */
function readAgentRunId(content: MatrixEvent['content']): string | undefined {
  const run = content['org.agentteams.run'];
  const nested = run && typeof run === 'object'
    ? (run as Record<string, unknown>).run_id
    : undefined;
  const flat = content['org.agentteams.run_id'];
  const value = typeof nested === 'string' ? nested : typeof flat === 'string' ? flat : undefined;
  return value && value.length > 0 ? value : undefined;
}

function isMatrixStreaming(content: MatrixEvent['content']): boolean {
  const status = content['org.agentteams.status'] ?? content.status;
  // MSC4357 live marker: openclaw rewrites one event once per second and drops
  // the marker on the final revision. The absence of the marker is the only
  // deterministic "stream finished" signal it sends, so it must participate in
  // streaming state instead of relying on a non-existent status field.
  const live = content['org.matrix.msc4357.live'];
  return (live !== undefined && live !== null)
    || content['org.agentteams.streaming'] === true
    || content['m.streaming'] === true
    || content.streaming === true
    || status === 'streaming'
    || status === 'in_progress';
}

/** Agent run status badge value, e.g. `streaming`, `in_progress`, `success`, `failed`. */
export function isMatrixAgentStatus(content: MatrixEvent['content']): string | undefined {
  const status = content['org.agentteams.status'] ?? content.status;
  if (typeof status === 'string' && status.length > 0) return status;
  return undefined;
}

/**
 * Long answers can arrive as several messages: the first block is streamed
 * into the placeholder via m.replace, then the remaining blocks are sent as
 * fresh top-level messages. Without folding them back the answer visually
 * breaks into disconnected bubbles the moment streaming ends. Each trailing
 * fragment arrives right after the edited answer, so a short gap plus the
 * edited-predecessor check separates it from a genuinely new agent turn.
 */
const ANSWER_FRAGMENT_MAX_GAP_MS = 10_000;

function isPlainAgentText(message: DisplayMessage): boolean {
  if (message.isMe || message.type !== 'm.text') return false;
  if (message.mediaUrl || (message.fileRefs?.length ?? 0) > 0) return false;
  if (message.workflow || (message.agentBlocks?.length ?? 0) > 0) return false;
  const content = message.rawContent ?? {};
  return !content['agentteams.workflow']
    && !content['org.agentteams.run']
    && !content['com.agentteams.long_message'];
}

function joinText(head: string, tail: string): string {
  const a = head.trimEnd();
  const b = tail.trimStart();
  if (!a) return b;
  if (!b) return a;
  return `${a}\n\n${b}`;
}

function joinOptionalText(head: string | undefined, tail: string | undefined): string | undefined {
  if (!head) return tail;
  if (!tail) return head;
  return joinText(head, tail);
}

function canAppendAnswerFragment(head: DisplayMessage, fragment: DisplayMessage): boolean {
  // Only an already-edited answer (the streamed first block) absorbs tail
  // blocks; a fresh message after a non-streamed answer is a new turn.
  if ((head.revisionCount ?? 0) === 0) return false;
  // A fragment that was itself revised is another streamed answer, not a tail.
  if ((fragment.revisionCount ?? 0) > 0) return false;
  if (head.sender !== fragment.sender) return false;
  if (head.threadId !== fragment.threadId) return false;
  if (fragment.replyToEventId) return false;
  if (fragment.timestamp - head.timestamp > ANSWER_FRAGMENT_MAX_GAP_MS) return false;
  return isPlainAgentText(head) && isPlainAgentText(fragment);
}

function appendAnswerFragment(head: DisplayMessage, fragment: DisplayMessage): DisplayMessage {
  const headText = head.content.trimEnd();
  const tailText = fragment.content.trim();
  const timestamp = Math.max(head.timestamp, fragment.timestamp);
  // Some managers repeat the last block verbatim before finalising; keep the
  // first copy instead of showing it twice.
  if (tailText && headText.endsWith(tailText)) {
    return { ...head, timestamp };
  }
  return {
    ...head,
    content: joinText(head.content, fragment.content),
    formattedContent: joinOptionalText(head.formattedContent, fragment.formattedContent),
    timestamp,
  };
}

export function mergeAnswerFragments(messages: DisplayMessage[]): DisplayMessage[] {
  const merged: DisplayMessage[] = [];
  for (const message of messages) {
    const head = merged[merged.length - 1];
    if (head && canAppendAnswerFragment(head, message)) {
      merged[merged.length - 1] = appendAnswerFragment(head, message);
    } else {
      merged.push(message);
    }
  }
  return merged;
}

/**
 * Collapses Matrix message revisions into their root event. Agent revisions
 * are sorted by the edit time so the final answer lands after the run's
 * process messages; human edits keep the original position.
 *
 * Thread replies (m.thread relations) are counted on the root and fetched
 * on demand by the thread panel. Keeping them out of the main timeline
 * prevents runtime replies from appearing as duplicate top-level messages.
 */
export function formatMatrixEvents(
  events: MatrixEvent[],
  currentUserId: string,
  { includeThreadReplies = false } = {},
): DisplayMessage[] {
  const messages = new Map<string, DisplayMessage>();
  const pendingRevisions = new Map<string, { message: DisplayMessage; count: number }>();
  const replyCounts = new Map<string, number>();
  const orphanReplies = new Map<string, DisplayMessage[]>();

  // Collect target ids of redaction events so deleted messages are dropped.
  const redactedIds = new Set<string>();
  for (const event of events) {
    if (event.type === 'm.room.redaction') {
      const redacts = (event as { redacts?: string }).redacts;
      if (redacts) redactedIds.add(redacts);
    }
  }

  for (const event of [...events].sort((a, b) => a.origin_server_ts - b.origin_server_ts)) {
    if (redactedIds.has(event.event_id)) continue;
    if (event.type === 'm.room.redaction') continue;
    if (isAssistantControlEvent(event)) continue;

    const formatted = formatMatrixEvent(event, currentUserId);
    if (!formatted) continue;

    const relation = event.content['m.relates_to'] as {
      rel_type?: string;
      event_id?: string;
    } | undefined;
    const rootId = relation?.rel_type === 'm.replace' ? relation.event_id : undefined;

    if (rootId) {
      const root = messages.get(rootId);
      if (root) {
        // Re-render the root in place, but keep the original event id so read
        // markers and edits still resolve to the root event.
        //
        // Timestamp policy: agent answers are delivered by editing an early
        // placeholder ("处理中..."), while the run's process messages
        // (thinking / tool calls) arrive in between. Sorting the revised root
        // by the edit time places the final answer after those messages.
        // Human edits (typo fixes) keep the original position.
        //
        // Receipt policy: the root stays the reply anchor (`canonicalEventId`)
        // while the edit event is the latest raw event (`latestEventId`).
        // m.fully_read must point at the edit, otherwise the server still
        // considers the replacement unread.
        const editIds = [...(root.sourceEventIds ?? [root.eventId ?? rootId]), event.event_id];
        messages.set(rootId, {
          ...formatted,
          id: rootId,
          rawContent: { ...formatted.rawContent, [READ_AUDIENCE_KEY]: root.rawContent?.[READ_AUDIENCE_KEY] },
          eventId: rootId,
          replyToEventId: root.replyToEventId,
          canonicalEventId: rootId,
          latestEventId: event.event_id,
          sourceEventIds: [...new Set(editIds.filter((id): id is string => Boolean(id)))],
          timestamp: root.isMe ? root.timestamp : Math.max(root.timestamp, formatted.timestamp),
          isEdited: true,
          revisionCount: (root.revisionCount ?? 0) + 1,
        });
      } else {
        const pending = pendingRevisions.get(rootId);
        pendingRevisions.set(rootId, {
          message: {
            ...formatted,
            canonicalEventId: rootId,
            latestEventId: event.event_id,
            sourceEventIds: [...new Set([
              ...(pending?.message.sourceEventIds ?? []),
              event.event_id,
            ])],
          },
          count: (pending?.count ?? 0) + 1,
        });
      }
      continue;
    }

    // Thread replies belong to the thread panel. Keep their count on the root
    // so the main timeline can expose an entry point for opening that panel.
    //
    // Exceptions:
    // 1. When the reply sender matches the root's sender (agent continuing
    //    its own response — e.g. Hermes delivering the main answer as a thread
    //    reply to its own placeholder), keep it inline.
    // 2. When the root is the current user's message and the reply is from an
    //    agent — the agent's final answer should stay in the main timeline,
    //    not be hidden in a sub-thread.
    if (!includeThreadReplies && formatted.isThreadReply && formatted.threadId) {
      const rootMessage = messages.get(formatted.threadId);
      if (!rootMessage) {
        // The root is outside the loaded window (pagination / sync gap). The
        // reply still carries content the user may need (often the only
        // answer a runtime produced), so keep it as a detached thread turn
        // instead of counting it into a thread that can never be opened.
        const orphan = orphanReplies.get(formatted.threadId) ?? [];
        orphan.push(formatted);
        orphanReplies.set(formatted.threadId, orphan);
        replyCounts.set(formatted.threadId, (replyCounts.get(formatted.threadId) ?? 0) + 1);
        continue;
      }
      const isUserRoot = rootMessage.sender === currentUserId;
      if (rootMessage.sender !== formatted.sender && !isUserRoot) {
        replyCounts.set(formatted.threadId, (replyCounts.get(formatted.threadId) ?? 0) + 1);
        continue;
      }
    }

    const revision = pendingRevisions.get(event.event_id);
    messages.set(
      event.event_id,
      revision
        ? {
            ...revision.message,
            id: event.event_id,
            rawContent: { ...revision.message.rawContent, [READ_AUDIENCE_KEY]: formatted.rawContent?.[READ_AUDIENCE_KEY] },
            eventId: event.event_id,
            replyToEventId: formatted.replyToEventId,
            revisionCount: revision.count,
            // Same policy as the in-place merge above: agent answers sort at
            // the edit time, human edits stay at the original position.
            timestamp: formatted.isMe ? formatted.timestamp : Math.max(formatted.timestamp, revision.message.timestamp),
          }
        : formatted
    );
    pendingRevisions.delete(event.event_id);
  }

  for (const [rootId, revision] of pendingRevisions) {
    messages.set(rootId, {
      ...revision.message,
      id: rootId,
      eventId: rootId,
      canonicalEventId: rootId,
      isEdited: true,
      revisionCount: revision.count,
    });
  }

  // Missing thread roots: project the replies as one detached turn anchored on
  // the thread root id so the thread panel can still request its relations.
  for (const [rootId, replies] of orphanReplies) {
    // A revision can recover the root without its placeholder being loaded.
    // Keep that final answer, applying the normal thread rules to the replies.
    const recoveredRoot = messages.get(rootId);
    if (recoveredRoot) {
      let inlineCount = 0;
      for (const reply of replies) {
        if (reply.sender === recoveredRoot.sender || recoveredRoot.sender === currentUserId) {
          messages.set(reply.id, reply);
          inlineCount++;
        }
      }
      const count = (replyCounts.get(rootId) ?? 0) - inlineCount;
      if (count > 0) replyCounts.set(rootId, count);
      else replyCounts.delete(rootId);
      continue;
    }
    const first = replies[0];
    const last = replies[replies.length - 1];
    const sourceEventIds = [...new Set(
      [
        rootId,
        ...replies.flatMap((reply) => [reply.id, reply.eventId, ...(reply.sourceEventIds ?? [])]),
      ].filter((id): id is string => Boolean(id)),
    )];
    messages.set(rootId, {
      ...first,
      id: rootId,
      eventId: first.eventId ?? first.id,
      canonicalEventId: rootId,
      latestEventId: last.eventId ?? last.id,
      sourceEventIds,
      content: replies.map((reply) => reply.content).filter(Boolean).join('\n\n'),
      formattedContent: replies.length === 1 ? first.formattedContent : undefined,
      timestamp: last.timestamp,
      isStreaming: replies.some((reply) => reply.isStreaming),
      detached: true,
      // ChatIR owns the turn; the legacy grouper must not re-fold it.
      turnId: rootId,
      threadId: rootId,
      isThreadReply: false,
      replyCount: replies.length,
      revisionCount: undefined,
    });
  }

  const result = [...messages.values()];
  for (const message of result) {
    const count = replyCounts.get(message.id);
    if (count) message.replyCount = count;
  }

  return mergeAnswerFragments(result.sort((a, b) => a.timestamp - b.timestamp));
}
