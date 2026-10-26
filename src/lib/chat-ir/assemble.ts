/**
 * ChatIR — turn assembly over the formatted Matrix timeline.
 *
 * `formatMatrixEvents` already owns the hard Matrix mechanics (edit merging,
 * redactions, thread collapsing). This layer adds what a chat timeline needs
 * on top of raw events:
 *
 *  - turn identity (run id > thread root > event id) and membership,
 *  - answer selection per runtime profile (qwenpaw answers only by editing
 *    its root; thread text there is narration),
 *  - canonical vs latest event ids (reply anchor vs m.fully_read target),
 *  - attachment relations attached to their exact target step,
 *  - interrupted/detached states (display only, never membership),
 *  - top-level media paired to the turn that mentions it, otherwise kept.
 *
 * Assembly is two-pass: raw relations are indexed first, then turns are
 * resolved. Message arrival order therefore cannot change the result.
 */

import type { DisplayMessage } from '@/hooks/use-matrix';
import type { MatrixEvent } from '@/lib/matrix-api';
import type { AttachmentPayload, ParsedA2uiBlock } from '@/lib/a2ui/parser';
import { parseLongMessage, parseEmbeddedAgentReprBlocks } from '@/lib/a2ui/parser';
import { isAgentPlaceholderBody, normalizeToBlocks } from '@/lib/a2ui/normalize';
import { parseWorkerLifecycleNotice } from '@/lib/chat-lifecycle-notice';
import type { ChatRuntimeProfile, ChatTurn, ChatTurnState } from './types';
import { resolveRuntimeProfile, rulesFor } from './profiles';

/** A top-level tool run can pause for minutes; only heuristic lanes use this. */
const TOP_LEVEL_TURN_MAX_GAP_MS = 10 * 60 * 1000;

/** No answer after this window renders the turn as interrupted. */
export const NO_ANSWER_STALE_MS = 5 * 60 * 1000;

/** Top-level media must land this close to the turn that names it. */
const MEDIA_PAIR_MAX_GAP_MS = 2 * 60 * 1000;

const ATTACHMENT_REL_TYPES = new Set([
  'com.agentteams.attachment',
  'org.agentteams.attachment',
]);

const FOLDABLE_BLOCK_TYPES: ReadonlySet<ParsedA2uiBlock['type']> = new Set([
  'thinking',
  'tool_call',
  'text',
]);

export interface RuntimeOwner {
  runtime?: string | null;
  workerName?: string;
}

export interface ChatIrOptions {
  currentUserId: string;
  /** MXID → owning worker, stamped before assembly. */
  runtimeMap?: Record<string, RuntimeOwner>;
  /** Injectable clock (tests). */
  now?: number;
}

export interface ChatIrResult {
  messages: DisplayMessage[];
  turns: ChatTurn[];
  /** Latest visible raw event — m.fully_read target. */
  latestEventId: string | null;
  /** Latest non-thread raw event — room m.read receipt target. */
  latestTopLevelEventId: string | null;
  /** Thread root id → every sender that participated (root + replies). */
  threadParticipants: Record<string, string[]>;
}

interface RawMeta {
  id: string;
  sender: string;
  ts: number;
  order: number;
  relType?: string;
  relTargetId?: string;
  isThreadReply: boolean;
  attachment?: ParsedA2uiBlock;
}

interface RawIndex {
  byId: Map<string, RawMeta>;
  /** Attachment event id → target event id. */
  attachmentTargets: Map<string, string>;
  attachmentsByTarget: Map<string, ParsedA2uiBlock[]>;
  threadParticipants: Map<string, Set<string>>;
  latestEventId: string | null;
  latestTopLevelEventId: string | null;
}

function extractAttachment(content: Record<string, unknown>): AttachmentPayload | null {
  const longMessage = parseLongMessage(content['com.agentteams.long_message']);
  if (longMessage) return longMessage;
  const url = typeof content.url === 'string' ? content.url : undefined;
  if (!url) return null;
  const body = typeof content.body === 'string' ? content.body.trim() : '';
  const info = content.info as { mimetype?: string } | undefined;
  return {
    url,
    filename: body || 'attachment',
    mimetype: info?.mimetype || 'application/octet-stream',
  };
}

function buildRawIndex(events: MatrixEvent[]): RawIndex {
  const redacted = new Set<string>();
  for (const event of events) {
    if (event.type === 'm.room.redaction') {
      const target = (event as { redacts?: string }).redacts;
      if (target) redacted.add(target);
    }
  }

  const sorted = [...events]
    .map((event, order) => ({ event, order }))
    .sort((a, b) =>
      a.event.origin_server_ts - b.event.origin_server_ts || a.order - b.order);

  const index: RawIndex = {
    byId: new Map(),
    attachmentTargets: new Map(),
    attachmentsByTarget: new Map(),
    threadParticipants: new Map(),
    latestEventId: null,
    latestTopLevelEventId: null,
  };

  for (const { event, order } of sorted) {
    if (event.type !== 'm.room.message' || redacted.has(event.event_id)) continue;
    const content = (event.content ?? {}) as Record<string, unknown>;
    const relation = content['m.relates_to'] as
      | { rel_type?: string; event_id?: string }
      | undefined;
    const isThreadReply = relation?.rel_type === 'm.thread' && Boolean(relation.event_id);

    index.byId.set(event.event_id, {
      id: event.event_id,
      sender: event.sender,
      ts: event.origin_server_ts,
      order,
      relType: relation?.rel_type,
      relTargetId: relation?.event_id,
      isThreadReply,
    });

    index.latestEventId = event.event_id;
    if (!isThreadReply) index.latestTopLevelEventId = event.event_id;

    if (isThreadReply && relation?.event_id) {
      const participants = index.threadParticipants.get(relation.event_id) ?? new Set<string>();
      participants.add(event.sender);
      index.threadParticipants.set(relation.event_id, participants);
    } else if (relation?.rel_type !== 'm.replace') {
      const participants = index.threadParticipants.get(event.event_id) ?? new Set<string>();
      participants.add(event.sender);
      index.threadParticipants.set(event.event_id, participants);
    }

    if (relation?.rel_type && ATTACHMENT_REL_TYPES.has(relation.rel_type) && relation.event_id) {
      const payload = extractAttachment(content);
      if (payload) {
        const block: ParsedA2uiBlock = {
          type: 'attachment',
          payload: payload as unknown as Record<string, unknown>,
        };
        index.attachmentTargets.set(event.event_id, relation.event_id);
        const list = index.attachmentsByTarget.get(relation.event_id) ?? [];
        list.push(block);
        index.attachmentsByTarget.set(relation.event_id, list);
      }
    }
  }

  return index;
}

function stampOwners(
  messages: DisplayMessage[],
  runtimeMap: Record<string, RuntimeOwner> | undefined,
): DisplayMessage[] {
  if (!runtimeMap) return messages;
  return messages.map((message) => {
    const owner = runtimeMap[message.sender];
    if (!owner) return message;
    return {
      ...message,
      runtime: (owner.runtime ?? message.runtime) as DisplayMessage['runtime'],
      workerName: owner.workerName ?? message.workerName,
    };
  });
}

function blockInput(message: DisplayMessage) {
  return {
    body: typeof message.content === 'string' ? message.content : '',
    formattedBody: typeof message.formattedContent === 'string' ? message.formattedContent : undefined,
    content: message.rawContent ?? {},
    isStreaming: !!message.isStreaming,
    isMine: message.isMe,
    runtime: message.runtime ?? null,
  };
}

/** Blocks a message contributes to a turn, or null when it stays a tile. */
function turnBlocksOf(message: DisplayMessage): ParsedA2uiBlock[] | null {
  if (message.isMe || !message.workerName) return null;
  if (message.workflow) return null;
  if (message.mediaUrl) return null;
  if (message.fileRefs && message.fileRefs.length > 0) return null;
  if (message.type !== 'm.text' && message.type !== 'm.notice') return null;
  if (parseWorkerLifecycleNotice(message.content)) return null;
  const blocks = normalizeToBlocks(blockInput(message));
  if (blocks.length === 0) return null;
  return blocks.every((block) => FOLDABLE_BLOCK_TYPES.has(block.type)) ? blocks : null;
}

function allBlocksOf(message: DisplayMessage): ParsedA2uiBlock[] {
  return normalizeToBlocks(blockInput(message));
}

function textOfBlocks(blocks: ParsedA2uiBlock[]): string {
  return blocks
    .filter((block): block is ParsedA2uiBlock & { text: string } =>
      block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .filter((text) => text.trim().length > 0 && !isAgentPlaceholderBody(text))
    .join('\n\n')
    .trim();
}

function laneOf(message: DisplayMessage): string {
  if (message.runId) return `run:${message.runId}`;
  if (message.detached) return `thread:${message.id}`;
  if (message.isThreadReply && message.threadId) return `thread:${message.threadId}`;
  return `thread:${message.canonicalEventId ?? message.eventId ?? message.id}`;
}

function isExplicitLane(message: DisplayMessage): boolean {
  return Boolean(message.runId || message.isThreadReply || message.detached);
}

/** Files/images a runtime delivers mid-run (thread announcement or upload). */
function isRunMedia(message: DisplayMessage): boolean {
  return Boolean(message.mediaUrl)
    || (message.fileRefs?.length ?? 0) > 0
    || /\[(?:File|Image|Video|Audio):/i.test(message.content ?? '');
}

function messageEventIds(message: DisplayMessage): string[] {
  return [...new Set(
    [message.id, message.eventId, ...(message.sourceEventIds ?? [])]
      .filter((id): id is string => Boolean(id)),
  )];
}

function attachmentsFor(
  message: DisplayMessage,
  index: RawIndex,
): ParsedA2uiBlock[] {
  const blocks: ParsedA2uiBlock[] = [];
  const seen = new Set<string>();
  for (const id of messageEventIds(message)) {
    for (const block of index.attachmentsByTarget.get(id) ?? []) {
      const payload = block.payload as unknown as AttachmentPayload | undefined;
      const key = payload ? `${payload.url}\u0000${payload.filename}` : `${id}:${blocks.length}`;
      if (seen.has(key)) continue;
      seen.add(key);
      blocks.push(block);
    }
  }
  return blocks;
}

interface Entry {
  message: DisplayMessage;
  blocks: ParsedA2uiBlock[];
  attachments: ParsedA2uiBlock[];
  text: string;
  /** Copaw agentscope repr dump: a process step, never the turn's answer. */
  repr: boolean;
}

function entryOf(message: DisplayMessage, index: RawIndex): Entry {
  const blocks = allBlocksOf(message);
  return {
    message,
    blocks,
    attachments: attachmentsFor(message, index),
    text: textOfBlocks(blocks),
    repr: message.runtime === 'copaw'
      && parseEmbeddedAgentReprBlocks(typeof message.content === 'string' ? message.content : '') !== null,
  };
}

function isAnswerEntry(
  profile: ChatRuntimeProfile,
  entry: Entry,
  detached: boolean,
): boolean {
  if (!entry.text || entry.repr) return false;
  if (detached) return true;
  if (profile === 'qwenpaw') {
    // QwenPaw answers by editing the root placeholder; thread text is the
    // run's narration and must stay inside the process fold.
    return !entry.message.isThreadReply;
  }
  return true;
}

interface WorkingTurn {
  key: string;
  sender: string;
  profile: ChatRuntimeProfile;
  runtime: DisplayMessage['runtime'];
  workerName: string;
  entries: Entry[];
  explicit: boolean;
  topLevel: boolean;
  answered: boolean;
  detached: boolean;
  startedAt: number;
}

function lastTsOf(turn: WorkingTurn): number {
  return turn.entries[turn.entries.length - 1].message.timestamp;
}

function canJoin(
  open: WorkingTurn,
  message: DisplayMessage,
  entry: Entry,
  key: string,
  index: RawIndex,
): boolean {
  if (open.detached !== !!message.detached) return false;
  if (key === open.key) return true;
  if (open.explicit || isExplicitLane(message)) return false;
  if (!open.topLevel) return false;
  const rules = rulesFor(open.profile);
  if (!rules.foldsTopLevelProcess) return false;
  if ((message.revisionCount ?? 0) > 0) {
    // A revised root whose placeholder existed before this run started is the
    // run's in-place answer (copaw/qwenpaw edit "处理中..." once the work is
    // done), so it belongs to the open process fold. One created later starts
    // a fresh turn of its own.
    const created = index.byId.get(message.id)?.ts;
    if (created === undefined || created > open.startedAt) return false;
  }
  if (isAgentPlaceholderBody(message.content)) return false;
  if (open.answered) return false;
  if (message.timestamp - lastTsOf(open) > TOP_LEVEL_TURN_MAX_GAP_MS) return false;
  // Only process notices or a first text answer may extend a top-level run.
  return entry.blocks.length > 0;
}

function chooseAnswer(
  profile: ChatRuntimeProfile,
  entries: Entry[],
  detached: boolean,
): Entry | null {
  const withText = entries.filter((entry) => entry.text);
  if (withText.length === 0) return null;
  if (detached) return withText[withText.length - 1];

  // Copaw's agentscope repr text is reasoning/tool output; a later plain text
  // step is the answer. Only fall back to repr text when nothing else exists.
  const answerable = withText.filter((entry) => !entry.repr);
  if (answerable.length === 0) return withText[withText.length - 1];
  const root = entries.find((entry) => !entry.message.isThreadReply) ?? null;
  if (profile === 'qwenpaw') {
    return root && root.text ? root : null;
  }
  if (profile === 'openclaw' || profile === 'manager') {
    return answerable[answerable.length - 1];
  }
  // An edited root is the runtime's in-place final answer; otherwise the last
  // text step is the best answer candidate.
  if (root && root.text && !root.repr && (root.message.revisionCount ?? 0) > 0) return root;
  return answerable[answerable.length - 1];
}

function latestEventIdOf(entries: Entry[]): { latest: string; latestTopLevel: string | null } {
  let latest = '';
  let latestTopLevel: string | null = null;
  let latestTs = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    const message = entry.message;
    const id = message.latestEventId ?? message.eventId ?? message.id;
    if (message.timestamp >= latestTs) {
      latestTs = message.timestamp;
      latest = id;
      if (!message.isThreadReply) latestTopLevel = id;
    }
  }
  return { latest, latestTopLevel };
}

function lifecyclePauses(events: MatrixEvent[]): Map<string, number> {
  const paused = new Map<string, number>();
  for (const event of events) {
    if (event.type !== 'm.room.message') continue;
    const body = typeof event.content.body === 'string' ? event.content.body : '';
    const notice = parseWorkerLifecycleNotice(body);
    if (!notice) continue;
    if (notice.kind === 'paused') paused.set(notice.worker, event.origin_server_ts);
    else paused.delete(notice.worker);
  }
  return paused;
}

export function assembleChatTimeline(
  messages: DisplayMessage[],
  events: MatrixEvent[],
  options: ChatIrOptions,
): ChatIrResult {
  const now = options.now ?? Date.now();
  const index = buildRawIndex(events);
  const pauses = lifecyclePauses(events);
  const stamped = stampOwners(messages, options.runtimeMap);

  // Suppress attachment relation events whose target is present: they render
  // inside the target step. Untargeted ones stay standalone (never drop).
  const visible = stamped.filter((message) => {
    const targetId = index.attachmentTargets.get(message.id);
    if (!targetId) return true;
    return !stamped.some((candidate) =>
      candidate !== message && messageEventIds(candidate).includes(targetId));
  });

  const sorted = [...visible]
    .map((message, order) => ({ message, order }))
    .sort((a, b) =>
      a.message.timestamp - b.message.timestamp || a.order - b.order)
    .map(({ message }) => message);

  const projected: DisplayMessage[] = [];
  const turns: ChatTurn[] = [];
  /** Timeline slots: turns project in place, so a run keeps its start position
   * even when files, cards or long-message fallbacks arrive mid-run. */
  type Placement =
    | { kind: 'turn'; turn: WorkingTurn }
    | { kind: 'message'; message: DisplayMessage };
  const placements: Placement[] = [];
  let open: WorkingTurn | null = null;

  for (const message of sorted) {
    const blocks = turnBlocksOf(message);
    const explicit = isExplicitLane(message);
    const key = laneOf(message);
    const entry = entryOf(message, index);

    if (blocks) {
      const profile = resolveRuntimeProfile(message.runtime);
      if (open && open.sender === message.sender && canJoin(open, message, entry, key, index)) {
        open.entries.push(entry);
        open.answered = open.answered || isAnswerEntry(profile, entry, open.detached);
        continue;
      }
      open = {
        key,
        sender: message.sender,
        profile,
        runtime: message.runtime,
        workerName: message.workerName ?? message.senderShort,
        entries: [entry],
        explicit,
        topLevel: !message.isThreadReply && !message.detached,
        answered: isAnswerEntry(profile, entry, !!message.detached),
        detached: !!message.detached,
        startedAt: message.timestamp,
      };
      placements.push({ kind: 'turn', turn: open });
      continue;
    }

    // Interactive output, media, human messages: their own tiles. A runtime's
    // own files / long-message fallbacks do not end its run — closing here
    // split one QwenPaw run into several answerless bubbles.
    const sameLane = open && open.sender === message.sender && laneOf(message) === open.key;
    const mediaInRun = open
      && open.sender === message.sender
      && isRunMedia(message)
      && message.timestamp - lastTsOf(open) <= TOP_LEVEL_TURN_MAX_GAP_MS;
    if (!sameLane && !mediaInRun) open = null;
    placements.push({ kind: 'message', message });
  }

  for (const placement of placements) {
    if (placement.kind === 'message') {
      projected.push(enrichStandalone(placement.message, index));
      continue;
    }
    const turn = projectTurn(placement.turn, index, pauses, now, index.latestTopLevelEventId);
    if (turn.message) projected.push(turn.message);
    if (turn.turn) turns.push(turn.turn);
  }

  const paired = associateTopLevelMedia(projected, turns);

  const threadParticipants: Record<string, string[]> = {};
  for (const [rootId, participants] of index.threadParticipants) {
    threadParticipants[rootId] = [...participants];
  }

  return {
    messages: paired,
    turns,
    latestEventId: index.latestEventId,
    latestTopLevelEventId: index.latestTopLevelEventId,
    threadParticipants,
  };
}

/** A message's own ids; used to test whether an attachment target is present. */
function enrichStandalone(
  message: DisplayMessage,
  index: RawIndex,
): DisplayMessage {
  const attached = attachmentsFor(message, index);
  let blocks = message.precomputedBlocks;
  if (attached.length > 0) {
    blocks = [...(blocks ?? allBlocksOf(message)), ...attached];
  } else if (index.attachmentTargets.has(message.id)) {
    // Unmatched attachment relation: render the file card itself.
    const payload = extractAttachment((message.rawContent ?? {}) as Record<string, unknown>);
    if (payload) {
      blocks = [{
        type: 'attachment',
        payload: payload as unknown as Record<string, unknown>,
      }];
    }
  }
  const canonicalEventId = message.canonicalEventId ?? message.eventId ?? message.id;
  const latestEventId = message.latestEventId ?? message.eventId ?? message.id;
  return {
    ...message,
    precomputedBlocks: blocks,
    canonicalEventId,
    latestEventId,
    latestTopLevelEventId: index.latestTopLevelEventId ?? undefined,
    turnState: message.turnState ?? (message.detached ? 'detached' : undefined),
  };
}

interface ProjectedTurn {
  message: DisplayMessage | null;
  turn: ChatTurn | null;
}

function projectTurn(
  open: WorkingTurn,
  index: RawIndex,
  pauses: Map<string, number>,
  now: number,
  latestTopLevelEventId: string | null,
): ProjectedTurn {
  const entries = open.entries;
  const answer = chooseAnswer(open.profile, entries, open.detached);
  const answerText = answer?.text ?? '';

  const processBlocks: ParsedA2uiBlock[] = [];
  for (const entry of entries) {
    for (const block of entry.blocks) {
      if (block.type === 'text') {
        if (!block.text?.trim() || isAgentPlaceholderBody(block.text)) continue;
        if (entry === answer) continue;
        processBlocks.push({ ...block, inProcess: true });
        continue;
      }
      processBlocks.push(block);
    }
    processBlocks.push(...entry.attachments);
  }
  if (answerText) {
    processBlocks.push({
      type: 'text',
      text: answerText,
      isStreaming: answer?.message.isStreaming || undefined,
    });
  }

  const rootEntry =
    entries.find((entry) => !entry.message.isThreadReply && !entry.message.detached)
    ?? null;
  const rootMessage = (rootEntry ?? entries[0]).message;
  const detached = open.detached;
  // A segment that starts mid-thread (an interactive tile split the run) has
  // no root entry; keying it by the root id would duplicate the earlier turn.
  const turnId = detached
    ? rootMessage.id
    : rootEntry
      ? rootEntry.message.canonicalEventId ?? rootEntry.message.eventId ?? rootEntry.message.id
      : rootMessage.id;
  const canonicalEventId = detached
    ? rootMessage.id
    : rootMessage.canonicalEventId ?? rootMessage.eventId ?? rootMessage.id;
  const { latest, latestTopLevel } = latestEventIdOf(entries);
  const lastEntry = entries[entries.length - 1];
  const startedAt = open.startedAt;
  const lastEventAt = lastEntry.message.timestamp;
  const streaming = entries.some((entry) => entry.message.isStreaming);

  const pausedAt = pauses.get(open.workerName);
  const paused = pausedAt !== undefined && pausedAt >= startedAt && lastEventAt <= pausedAt;
  let state: ChatTurnState;
  if (detached) state = 'detached';
  else if (streaming) state = 'running';
  else if (answerText) state = 'finalized';
  else if (paused || now - lastEventAt > NO_ANSWER_STALE_MS) state = 'interrupted';
  else state = 'pending';

  const sourceEventIds = [...new Set(
    entries.flatMap((entry) => messageEventIds(entry.message)),
  )];

  const message: DisplayMessage = {
    ...rootMessage,
    id: turnId,
    eventId: rootMessage.eventId ?? rootMessage.id,
    canonicalEventId,
    latestEventId: latest,
    latestTopLevelEventId: latestTopLevel ?? latestTopLevelEventId ?? undefined,
    sourceEventIds,
    turnId,
    turnState: state,
    detached,
    content: answerText,
    formattedContent: undefined,
    timestamp: answer?.message.timestamp ?? lastEventAt,
    type: 'm.text',
    isStreaming: streaming,
    isEdited: lastEntry.message.isEdited ?? rootMessage.isEdited,
    revisionCount: rootMessage.revisionCount ?? lastEntry.message.revisionCount,
    agentStatus: [...entries].reverse().find((entry) => entry.message.agentStatus)?.message.agentStatus,
    precomputedBlocks: processBlocks,
    replyCount: rootMessage.replyCount,
    threadId: rootMessage.threadId,
    threadParticipants: rootMessage.threadId
      ? index.threadParticipants.get(rootMessage.threadId)
        ? [...(index.threadParticipants.get(rootMessage.threadId) as Set<string>)]
        : undefined
      : undefined,
  };

  // A missing root has no event to edit/delete; keep the first loaded reply id
  // as the action target while the synthetic root id anchors the thread.
  if (detached) {
    message.eventId = rootMessage.eventId ?? rootMessage.id;
  }

  const turn: ChatTurn = {
    turnId,
    sender: rootMessage.sender,
    runtime: open.profile,
    state,
    canonicalEventId,
    latestEventId: latest,
    latestTopLevelEventId: latestTopLevel ?? latestTopLevelEventId,
    sourceEventIds,
    detached,
    startedAt,
    lastEventAt,
  };

  return { message, turn };
}

function basenameOf(url: string | undefined, body: string | undefined): string | null {
  const source = (url ?? '').split(/[?#]/)[0];
  const path = decodeURIComponent(source.split('/').pop() ?? '').trim();
  const nameFromBody = (body ?? '').trim();
  // Uploads carry the filename in the body and an opaque mxc media id in the
  // URL, so the body wins whenever it looks like a real filename.
  if (nameFromBody.length >= 4 && /^[^/\\]{3,}\.[A-Za-z0-9]{1,8}$/.test(nameFromBody)) {
    return nameFromBody;
  }
  if (path.length >= 4 && /\.[A-Za-z0-9]{1,8}$/.test(path)) return path;
  const bodyMatch = (body ?? '').match(/\[(?:File|Image|Video|Audio):\s*([^\]]+)\]/i);
  if (bodyMatch) {
    const name = bodyMatch[1].trim().split('/').pop() ?? '';
    return name.length >= 4 ? name : null;
  }
  return null;
}

/**
 * Top-level media carries no relation to the turn it belongs to. Associate it
 * (sourceEventIds) with the turn when exactly one turn of the same sender
 * mentions the unique filename. The media event always keeps its own tile:
 * its msgtype is what renders the image/video preview, which a folded text
 * turn cannot reproduce.
 */
function associateTopLevelMedia(
  messages: DisplayMessage[],
  turns: ChatTurn[],
): DisplayMessage[] {
  const media = messages.filter((message) =>
    !!message.mediaUrl
    && !message.isMe
    && !message.isThreadReply
    && !message.detached);
  if (media.length === 0) return messages;

  const turnText = new Map<string, string>();
  for (const message of messages) {
    if (!message.turnId) continue;
    const blocks = message.precomputedBlocks ?? [];
    turnText.set(
      message.turnId,
      [message.content, ...blocks.map((block) => block.text ?? '')].join('\n'),
    );
  }
  const windows = new Map(turns.map((turn) => [turn.turnId, turn]));

  for (const file of media) {
    const name = basenameOf(file.mediaUrl, file.content);
    if (!name) continue;
    const sameName = media.filter((candidate) => basenameOf(candidate.mediaUrl, candidate.content) === name);
    if (sameName.length !== 1) continue;
    const candidates = messages.filter((candidate) => {
      if (!candidate.turnId || candidate.sender !== file.sender || candidate.mediaUrl) return false;
      const window = windows.get(candidate.turnId);
      const startedAt = window?.startedAt ?? candidate.timestamp;
      const lastEventAt = window?.lastEventAt ?? candidate.timestamp;
      if (file.timestamp < startedAt - MEDIA_PAIR_MAX_GAP_MS) return false;
      if (file.timestamp > lastEventAt + MEDIA_PAIR_MAX_GAP_MS) return false;
      return (turnText.get(candidate.turnId) ?? '').includes(name);
    });
    if (candidates.length !== 1) continue;
    const target = candidates[0];
    target.sourceEventIds = [...new Set([
      ...(target.sourceEventIds ?? []),
      ...messageEventIds(file),
    ])];
  }

  return messages;
}
