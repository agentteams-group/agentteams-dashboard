import type { TraceScope, TraceSummary } from './tracing-types';

export function traceInScope(trace: TraceSummary, scope: TraceScope): boolean {
  const worker = scope.workers.find((w) => w.name === trace.userId);
  if (!worker || !trace.tags.includes('agentteams') || !trace.tags.includes('worker-turn')) return false;
  const metadata = trace.metadata ?? {};
  const attributes = metadata.attributes as Record<string, unknown> | undefined;
  const recordedWorker = metadata['agentteams.worker.name'] ?? attributes?.['agentteams.worker.name'];
  if (recordedWorker != null && recordedWorker !== worker.name) return false;
  const teams = trace.tags.filter((tag) => tag.startsWith('team:')).map((tag) => tag.slice(5));
  const team = metadata['agentteams.team.id'] ?? attributes?.['agentteams.team.id'];
  if (typeof team === 'string' && team) teams.push(team);
  // A reassigned Worker must not expose its previous team's trace content.
  return worker.team ? teams.length > 0 && teams.every((t) => t === worker.team) : teams.length === 0;
}
