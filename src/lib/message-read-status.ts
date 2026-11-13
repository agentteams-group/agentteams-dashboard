import type { MatrixEvent } from './matrix-api';

export const READ_AUDIENCE_KEY = 'com.agentteams.read_audience';
export const SESSION_RECEIPT_TYPE = 'com.agentteams.session_receipt';

export interface ReadMember {
  userId: string;
  displayName: string;
  state: 'read' | 'unread';
  kind: 'agent' | 'human';
}

interface ReadMessage {
  eventId?: string;
  latestEventId?: string;
  sender: string;
  timestamp?: number;
  threadId?: string;
  rawContent?: Record<string, unknown>;
}

export interface MemberReadPosition {
  eventId: string;
  ts: number;
  eventTimestamp?: number;
  threadId?: string;
}

export function sessionReceiptTarget(event: MatrixEvent): string | null {
  if (event.type !== SESSION_RECEIPT_TYPE || event.content.version !== 1) return null;
  const relation = event.content['m.relates_to'] as { rel_type?: string; event_id?: string } | undefined;
  return relation?.rel_type === SESSION_RECEIPT_TYPE && typeof relation.event_id === 'string'
    && (event.content.status === 'read' || event.content.status === 'received') ? relation.event_id : null;
}

/** Missing support is intentionally invisible, including in the counts. */
export function messageReadMembers(message: ReadMessage, evidence: MatrixEvent[], positions: Record<string, MemberReadPosition>, humanUserIds: string[] = [], agentUserIds: string[] = []): ReadMember[] {
  const audience = message.rawContent?.[READ_AUDIENCE_KEY] as { version?: number; members?: Array<{ user_id: string; display_name?: string; kind?: string }> } | undefined;
  if (audience?.version !== 1 || !Array.isArray(audience.members) || !message.eventId) return [];
  const targetId = message.latestEventId || message.eventId;
  const mentions = message.rawContent?.['m.mentions'] as { user_ids?: string[]; room?: boolean } | undefined;
  const targets = !mentions?.room && Array.isArray(mentions?.user_ids) && mentions.user_ids.length > 0 ? new Set(mentions.user_ids) : null;
  const states = new Map<string, 'read' | 'unread'>();
  for (const event of evidence) {
    if (sessionReceiptTarget(event) !== targetId) continue;
    if (event.content.status === 'read') states.set(event.sender, 'read');
    else if (!states.has(event.sender)) states.set(event.sender, 'unread');
  }
  const seen = new Set<string>();
  return audience.members.flatMap((member) => {
    if (!member || typeof member.user_id !== 'string' || member.user_id === message.sender || seen.has(member.user_id) || (targets && !targets.has(member.user_id))) return [];
    seen.add(member.user_id);
    let state = states.get(member.user_id);
    if (!state && (member.kind === 'agent' || agentUserIds.includes(member.user_id))) return [];
    if (!state && member.kind !== 'human' && !humanUserIds.includes(member.user_id)) return [];
    const kind = state || member.kind === 'agent' ? 'agent' : 'human';
    if (kind === 'agent' && !state) return [];
    if (kind === 'human') {
      const position = positions[`${member.user_id}|${message.threadId || 'main'}`] || positions[member.user_id];
      const matchingThread = !position?.threadId || position.threadId === (message.threadId || 'main');
      state = position && matchingThread && (position.eventId === targetId || (targetId === message.eventId && position.eventTimestamp !== undefined && message.timestamp !== undefined && position.eventTimestamp > message.timestamp)) ? 'read' : 'unread';
    }
    return [{ userId: member.user_id, displayName: member.display_name || member.user_id.split(':')[0].slice(1), state: state!, kind }];
  });
}

export function messageReadStatusKey(homeserver: string, userId: string | null, roomId: string, eventId: string) {
  return ['message-read-status', homeserver, userId, roomId, eventId] as const;
}
