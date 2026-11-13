import type { MatrixEvent } from './matrix-api';

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
