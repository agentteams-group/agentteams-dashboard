import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { normalizeToBlocks } from '@/lib/a2ui/normalize';
import { recordHitlAudit } from '@/lib/hitl-audit';
import type { MatrixEvent } from '@/lib/matrix-api';

export interface HitlConfirmation {
  id: string;
  roomId: string;
  eventId: string;
  sender: string;
  toolName: string;
  triggeredBy?: string;
  parameters?: string;
  approveReply: string;
  rejectReply: string;
  /** v2 干预问题（F2.1）：存在 = 干预条目（非工具审批二态）。 */
  question?: string;
  timestamp: number;
}

export interface HitlResolution {
  id: string;
  status: 'answered' | 'expired';
  actor?: string;
  timestamp: number;
  answer?: string;
}

export interface PendingProjectKey {
  id: string;
  team?: string;
}

interface HitlInboxState {
  confirmations: Record<string, HitlConfirmation>;
  resolutions: Record<string, HitlResolution>;
  pendingChatRoomId: string | null;
  pendingProjectKey: PendingProjectKey | null;
  /** Atomically reads and clears the pending chat room deep-link. */
  takePendingChatRoomId: () => string | null;
  /** Atomically reads and clears the pending project deep-link. */
  takePendingProjectKey: () => PendingProjectKey | null;
  upsertConfirmation: (_item: HitlConfirmation) => void;
  dropConfirmation: (_id: string) => void;
  resolveConfirmation: (_id: string, _actor?: string, _answer?: string) => void;
  expireConfirmation: (_id: string, _actor?: string) => void;
  dropByEventId: (_roomId: string, _eventId: string) => void;
  resolveRoomReply: (
    _roomId: string,
    _sender: string,
    _body: string,
    _currentUserId: string,
    _relatedEventId?: string,
  ) => void;
  setPendingChatRoomId: (_roomId: string | null) => void;
  setPendingProjectKey: (_key: PendingProjectKey | null) => void;
  clearConfirmations: () => void;
}

/**
 * 已裁决记录的上限。`resolutions` 只用来「这个 id 我已经处理过了」的去重，
 * 旧条目掉出去不会让用户丢东西，所以它保留上限。
 *
 * 待办（`confirmations`）**不再截断**（方案 v3 C-4）：以前超出 50 条会按
 * timestamp 静默删最旧的，刷新后没人知道少了几条；一条干预被删就等于任务
 * 永远卡在阻塞态。量大的困扰交给 UI 折叠（「另有 N 条更早待处理」）。
 */
const MAX_RESOLUTIONS = 50;

function applyResolution(
  state: Pick<HitlInboxState, 'confirmations' | 'resolutions'>,
  resolution: HitlResolution,
): Pick<HitlInboxState, 'confirmations' | 'resolutions'> {
  const confirmations = { ...state.confirmations };
  delete confirmations[resolution.id];
  if (state.resolutions[resolution.id]) {
    return { confirmations, resolutions: state.resolutions };
  }

  const resolutions = { ...state.resolutions, [resolution.id]: resolution };
  const ids = Object.keys(resolutions);
  if (ids.length > MAX_RESOLUTIONS) {
    const sorted = ids.sort((a, b) => resolutions[a].timestamp - resolutions[b].timestamp);
    for (const id of sorted.slice(0, ids.length - MAX_RESOLUTIONS)) {
      delete resolutions[id];
    }
  }
  return { confirmations, resolutions };
}

export const useHitlInboxStore = create<HitlInboxState>()(
  persist(
    (set, get) => ({
  confirmations: {},
  resolutions: {},
  pendingChatRoomId: null,
  pendingProjectKey: null,

  upsertConfirmation: (item) =>
    set((state) => {
      if (item.id in state.resolutions) return state;
      const isNew = !(item.id in state.confirmations);
      // hitl.request 审计（F2.4）：仅新条目上报一次（m.replace 修订
      // 静默 upsert，不重复计审计）。
      if (isNew) {
        recordHitlAudit({
          action: 'request',
          confirmationId: item.id,
          roomId: item.roomId,
          toolName: item.toolName,
          question: item.question,
          actor: item.sender,
        });
      }
      const next = { ...state.confirmations, [item.id]: item };
      // 故意不截断：待办只能被答复或过期弄出去，不能因为列表长而被静默丢掉（C-4）。
      return { confirmations: next };
    }),

  dropConfirmation: (id) =>
    set((state) => {
      if (!(id in state.confirmations)) return state;
      const next = { ...state.confirmations };
      delete next[id];
      return { confirmations: next };
    }),

  resolveConfirmation: (id, actor, answer) =>
    set((state) =>
      applyResolution(state, {
        id,
        status: 'answered',
        timestamp: Date.now(),
        ...(actor !== undefined ? { actor } : {}),
        ...(answer !== undefined ? { answer } : {}),
      }),
    ),

  expireConfirmation: (id, actor) =>
    set((state) =>
      applyResolution(state, {
        id,
        status: 'expired',
        timestamp: Date.now(),
        ...(actor !== undefined ? { actor } : {}),
      }),
    ),

  dropByEventId: (roomId, eventId) =>
    set((state) => {
      const match = Object.values(state.confirmations).find(
        (item) => item.roomId === roomId && item.eventId === eventId,
      );
      if (!match) return state;
      const next = { ...state.confirmations };
      delete next[match.id];
      return { confirmations: next };
    }),

  resolveRoomReply: (roomId, sender, body, currentUserId, relatedEventId) => {
    if (sender !== currentUserId) return;
    const kind = hitlResolutionKind(body);
    if (!kind) return;

    const pending = Object.values(get().confirmations).filter((item) => item.roomId === roomId);
    if (relatedEventId) {
      const linked = pending.find((item) => item.eventId === relatedEventId);
      if (linked) get().resolveConfirmation(linked.id, sender, body);
      // 显式指向某张卡片时不再猜测其它卡片：目标可能已在本地处理过。
      return;
    }

    // 干预答复只对应带 question 的干预条目；/approve 一类裁决优先对应
    // 工具确认。找不到同类条目时才回退到全部待办（单条待办场景）。
    const sameKind = pending.filter((item) => (kind === 'intervention' ? item.question : !item.question));
    if (kind === 'intervention' && sameKind.length === 0) return;
    const pool = sameKind.length > 0 ? sameKind : pending;
    const target = pool.sort((a, b) => a.timestamp - b.timestamp)[0];
    if (target) get().resolveConfirmation(target.id, sender, body);
  },

  setPendingChatRoomId: (roomId) => set({ pendingChatRoomId: roomId }),
  setPendingProjectKey: (key) => set({ pendingProjectKey: key }),
  takePendingChatRoomId: (): string | null => {
    const current = useHitlInboxStore.getState().pendingChatRoomId;
    if (current) {
      useHitlInboxStore.setState({ pendingChatRoomId: null });
    }
    return current;
  },
  takePendingProjectKey: (): PendingProjectKey | null => {
    const current = useHitlInboxStore.getState().pendingProjectKey;
    if (current) {
      useHitlInboxStore.setState({ pendingProjectKey: null });
    }
    return current;
  },
  clearConfirmations: () => set({ confirmations: {}, resolutions: {} }),
    }),
    {
      name: 'agentteams-hitl-inbox',
      version: 1,
      // 只存待办与已裁决集合。两个深链指针（pendingChatRoomId /
      // pendingProjectKey）是一次性的导航指令，刷新后重新应用会把用户弹回
      // 上一个房间；房间本身由 Matrix 侧重建，无需 here 冷启动。
      // 副作用（recordHitlAudit）也不会在 rehydrate 时重复跑，因为它在
      // upsertConfirmation 里，而 rehydrate 不经过 action。
      partialize: (state) => ({
        confirmations: state.confirmations,
        resolutions: state.resolutions,
      }),
    },
  ),
);

export function selectConfirmationList(
  confirmations: Record<string, HitlConfirmation>,
): HitlConfirmation[] {
  return Object.values(confirmations).sort((a, b) => b.timestamp - a.timestamp);
}

/** 「等我」事项的统一口径（C-1）：分项相加即 total，任何展示总数的地方都用它。 */
export interface PendingTally {
  /** 带 question 的干预请求。 */
  interventions: number;
  /** 工具审批（无 question 的确认）。 */
  approvals: number;
  /** 待接受的 Matrix 邀请。 */
  invites: number;
  /** 有 @我 未读的房间数。 */
  mentionRooms: number;
  total: number;
}

/**
 * 纯函数版「等我」计数：输入三个 store 的原始 map，输出分项与总数。
 * 组件侧请用 `usePendingTally()`（`src/hooks/use-pending-tally.ts`）。
 */
export function selectPendingTally(
  confirmations: Record<string, HitlConfirmation>,
  invites: Record<string, unknown>,
  roomMeta: Record<string, { unreadHighlightCount?: number }>,
): PendingTally {
  let interventions = 0;
  let approvals = 0;
  for (const item of Object.values(confirmations)) {
    if (item.question) interventions += 1;
    else approvals += 1;
  }
  const inviteCount = Object.keys(invites).length;
  const mentionRooms = Object.values(roomMeta).filter(
    (m) => (m.unreadHighlightCount ?? 0) > 0,
  ).length;
  return {
    interventions,
    approvals,
    invites: inviteCount,
    mentionRooms,
    total: interventions + approvals + inviteCount + mentionRooms,
  };
}

/** 多语言审批/拒绝关键词（大小写不敏感；见 FUNC-07）。 */
const APPROVE_KEYWORDS = new Set(['/approve', 'approve', 'approved', '同意', '批准', '允许']);
const REJECT_KEYWORDS = new Set(['/deny', 'deny', 'denied', '/reject', 'reject', 'rejected', '拒绝', '驳回', '不允许']);

const INTERVENTION_REPLY_MARKER = '【干预答复】';

/**
 * Worker/team 房间的答复会自动带上 `@worker` 前缀（见 confirmation-reply），
 * 因此判定前先剥离开头的 @ 提及，否则 `/approve` 和干预答复都匹配不到。
 */
export function stripLeadingMentions(body: string): string {
  let text = body.trim();
  const mention = /^@[^\s:]+(?::[^\s]+)?\s*/;
  while (mention.test(text)) {
    text = text.replace(mention, '');
  }
  return text;
}

export type HitlResolutionKind = 'intervention' | 'verdict';

export function hitlResolutionKind(body: string): HitlResolutionKind | null {
  const text = stripLeadingMentions(body).toLowerCase();
  if (text.startsWith(INTERVENTION_REPLY_MARKER)) return 'intervention';
  if (APPROVE_KEYWORDS.has(text) || REJECT_KEYWORDS.has(text)) return 'verdict';
  return null;
}

export function isHitlResolutionReply(body: string): boolean {
  return hitlResolutionKind(body) !== null;
}

export function resolveEventContent(event: MatrixEvent): Record<string, unknown> {
  const raw = (event.content ?? {}) as Record<string, unknown>;
  const relatesTo = raw['m.relates_to'] as { rel_type?: string } | undefined;
  if (relatesTo?.rel_type === 'm.replace') {
    const newContent = raw['m.new_content'] as Record<string, unknown> | undefined;
    if (newContent && typeof newContent === 'object') {
      return { ...raw, ...newContent };
    }
  }
  return raw;
}

export function rootEventIdOf(event: MatrixEvent): string {
  const relatesTo = event.content?.['m.relates_to'] as { rel_type?: string; event_id?: string } | undefined;
  if (relatesTo?.rel_type === 'm.replace' && typeof relatesTo.event_id === 'string' && relatesTo.event_id) {
    return relatesTo.event_id;
  }
  return event.event_id;
}

/**
 * 答复消息显式指向的卡片事件：标准回复（m.in_reply_to）或引用
 * （m.reference）。m.thread 是结构性关系（所有线程回复都指向根），
 * 不能当成「答复了根卡片」的证据。
 */
export function relatedEventIdOf(event: MatrixEvent): string | undefined {
  const relatesTo = event.content?.['m.relates_to'] as
    | { rel_type?: string; event_id?: string; 'm.in_reply_to'?: { event_id?: string } }
    | undefined;
  const inReplyTo = relatesTo?.['m.in_reply_to']?.event_id;
  if (typeof inReplyTo === 'string' && inReplyTo) return inReplyTo;
  if (
    relatesTo?.rel_type === 'm.reference' &&
    typeof relatesTo.event_id === 'string' &&
    relatesTo.event_id
  ) {
    return relatesTo.event_id;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function extractConfirmationFromEvent(
  event: MatrixEvent,
  roomId: string,
): HitlConfirmation | null {
  if (event.type !== 'm.room.message') return null;
  const content = resolveEventContent(event);
  const body = typeof content.body === 'string' ? content.body : '';
  const formattedBody = typeof content.formatted_body === 'string' ? content.formatted_body : undefined;

  const blocks = normalizeToBlocks({
    body,
    formattedBody,
    content,
    isStreaming: false,
  });
  const confirmation = blocks.find((block) => block.type === 'confirmation');
  if (!confirmation) return null;

  const payload = (confirmation.payload ?? {}) as Record<string, unknown>;
  const toolName = asString(payload.toolName) ?? asString(payload.tool_name) ?? '未知工具';
  const confirmationId = asString(payload.confirmation_id);
  const eventId = rootEventIdOf(event);
  const question =
    asString(payload.question) ??
    (Array.isArray(payload.questions)
      ? asString((payload.questions[0] as Record<string, unknown> | undefined)?.question)
      : undefined);

  return {
    id: confirmationId ?? `${roomId}:${eventId}`,
    roomId,
    eventId,
    sender: event.sender,
    toolName,
    triggeredBy: asString(payload.triggeredBy),
    parameters: asString(payload.parameters),
    approveReply: asString(payload.approveReply) ?? '/approve',
    rejectReply: asString(payload.rejectReply) ?? '拒绝',
    ...(question ? { question } : {}),
    timestamp: event.origin_server_ts,
  };
}

export function ingestHitlTimelineEvents(
  roomId: string,
  events: MatrixEvent[],
  currentUserId: string,
): void {
  const store = useHitlInboxStore.getState();
  const ordered = [...events].sort((a, b) => a.origin_server_ts - b.origin_server_ts);
  for (const event of ordered) {
    if (event.type !== 'm.room.message') continue;
    const confirmation = extractConfirmationFromEvent(event, roomId);
    if (confirmation) {
      store.upsertConfirmation(confirmation);
      continue;
    }
    // Non-confirmation message: resolve any pending approval, then drop by
    // event id if this is an m.replace revision (streaming finalization).
    const content = resolveEventContent(event);
    const body = typeof content.body === 'string' ? content.body : '';
    store.resolveRoomReply(roomId, event.sender, body, currentUserId, relatedEventIdOf(event));
    const relatesTo = event.content?.['m.relates_to'] as { rel_type?: string; event_id?: string } | undefined;
    if (relatesTo?.rel_type === 'm.replace' && relatesTo.event_id) {
      store.dropByEventId(roomId, relatesTo.event_id);
    }
  }
}
