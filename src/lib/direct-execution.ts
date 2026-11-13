import type { MatrixEvent } from './matrix-api';
import type { DisplayMessage } from '@/hooks/use-matrix';

export const EXECUTION_KEY = 'com.agentteams.execution';
export const CONTROL_KEY = 'com.agentteams.control';
export type ExecutionStatus = 'running' | 'stopping' | 'stopped' | 'completed' | 'failed' | 'unavailable';
export interface DirectExecution {
  runId: string;
  agentId: string;
  status: ExecutionStatus;
}
export interface DirectControl {
  action: 'stop' | 'steer';
  run_id: string;
  agent_id: string;
}

const phases: Record<ExecutionStatus, number> = { running: 0, stopping: 1, stopped: 2, completed: 2, failed: 2, unavailable: 2 };

/** Only the known peer in a verified two-member room can advertise controls. */
export function getDirectExecution(
  events: MatrixEvent[], userId: string | null, memberIds: string[], agentIds: string[] = [],
): DirectExecution | null {
  const members = new Set(memberIds);
  if (!userId || members.size !== 2 || !members.has(userId)) return null;
  const agentId = agentIds.find(id => id !== userId && members.has(id));
  if (!agentId) return null;
  const updates = events.flatMap(event => {
    if (event.sender !== agentId || event.type !== 'm.room.message') return [];
    const value = event.content[EXECUTION_KEY];
    if (!value || typeof value !== 'object') return [];
    const data = value as Record<string, unknown>;
    if (typeof data.run_id !== 'string' || !data.run_id || typeof data.status !== 'string'
      || !Object.hasOwn(phases, data.status) || !Array.isArray(data.capabilities)
      || !data.capabilities.includes('stop') || !data.capabilities.includes('steer')) return [];
    return [{ runId: data.run_id, status: data.status as ExecutionStatus, ts: event.origin_server_ts }];
  });
  // A late terminal event from an older run cannot replace the newer owner.
  const starts = updates.filter(update => update.status === 'running');
  const latest = (starts.length ? starts : updates).reduce<typeof updates[number] | null>(
    (current, update) => !current || update.ts > current.ts ? update : current, null,
  );
  if (!latest) return null;
  const state = updates.filter(update => update.runId === latest.runId).reduce(
    (current, update) => phases[update.status] > phases[current.status] ? update : current, latest,
  );
  return { runId: state.runId, status: state.status, agentId };
}

export function executionControl(execution: DirectExecution, action: DirectControl['action']): DirectControl {
  return { action, run_id: execution.runId, agent_id: execution.agentId };
}

/** A Stop request is not an acknowledgement. Only the Agent's stopped event marks a message. */
export function markStoppedMessages(messages: DisplayMessage[], events: MatrixEvent[], agentIds: string[] = []): DisplayMessage[] {
  const result = [...messages];
  const seen = new Set<string>();
  for (const event of events) {
    if (event.type !== 'm.room.message' || !agentIds.includes(event.sender)) continue;
    const data = event.content[EXECUTION_KEY] as Record<string, unknown> | undefined;
    if (!data || data.status !== 'stopped' || typeof data.run_id !== 'string') continue;
    const key = `${event.sender}:${data.run_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const index = typeof data.message_id === 'string' ? result.findIndex(message =>
      message.sender === event.sender && [message.id, message.eventId, message.turnId,
        ...(message.sourceEventIds ?? [])].includes(data.message_id as string)) : -1;
    if (index >= 0) {
      result[index] = { ...result[index], turnState: 'stopped', isStreaming: false };
    } else {
      // Cancellation can precede the first response, or its root may be outside
      // the loaded page. Show an acknowledgement without marking another run.
      result.push({ id: event.event_id, eventId: event.event_id, sender: event.sender,
        senderShort: event.sender.split(':')[0].slice(1), content: '', type: 'm.text',
        timestamp: event.origin_server_ts, isMe: false, turnState: 'stopped',
        sourceEventIds: [event.event_id], runId: data.run_id });
    }
  }
  return result.sort((a, b) => a.timestamp - b.timestamp);
}
