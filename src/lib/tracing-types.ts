export interface TraceSummary {
  id: string;
  name: string | null;
  timestamp: string;
  userId: string | null;
  sessionId: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  latency?: number | null;
  totalCost?: number | null;
}

export interface TraceObservation {
  id: string;
  parentObservationId: string | null;
  name: string | null;
  type: string;
  startTime: string;
  endTime: string | null;
  level: string;
  statusMessage?: string | null;
  model?: string | null;
  usage?: { input?: number; output?: number; total?: number };
  usageDetails?: Record<string, number>;
  calculatedTotalCost?: number | null;
  costDetails?: Record<string, number>;
  metadata?: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
}

export interface TraceDetail extends TraceSummary {
  observations: TraceObservation[];
  langfuseUrl: string | null;
}

export interface TraceList {
  data: TraceSummary[];
  meta: { page: number; totalPages: number; totalItems: number };
}

export function diagnoseTrace(observations: TraceObservation[]) {
  const tools = observations.filter((o) => o.type === 'TOOL' || o.metadata?.['gen_ai.operation.name'] === 'execute_tool');
  const identities = tools.map((o) => JSON.stringify([o.name, o.input]));
  const sorted = traceRows(observations).sort((a, b) => b.duration - a.duration);
  return {
    errors: observations.filter((o) => o.level === 'ERROR').length,
    tools: tools.length,
    failedRequests: observations.filter((o) => Number(o.metadata?.['http.response.status_code']) >= 400).length,
    repeatedTools: identities.length - new Set(identities).size,
    slowest: sorted.find((o) => o.observation.parentObservationId)?.observation.name ?? null,
  };
}

export function traceRows(observations: TraceObservation[]) {
  const ids = new Map(observations.map((observation) => [observation.id, observation]));
  function depth(observation: TraceObservation): number {
    let count = 0;
    const seen = new Set([observation.id]);
    let parent = observation.parentObservationId;
    while (parent && ids.has(parent) && !seen.has(parent)) {
      seen.add(parent);
      count++;
      parent = ids.get(parent)!.parentObservationId;
    }
    return count;
  }
  const sorted = [...observations].sort((a, b) =>
    Date.parse(a.startTime) - Date.parse(b.startTime) || depth(a) - depth(b));
  const start = Math.min(...sorted.map((o) => Date.parse(o.startTime)));
  const end = Math.max(...sorted.map((o) => Date.parse(o.endTime ?? o.startTime)));
  const duration = Math.max(1, end - start);
  return sorted.map((observation) => {
    const elapsed = Math.max(0, Date.parse(observation.endTime ?? observation.startTime) - Date.parse(observation.startTime));
    return {
      observation,
      depth: depth(observation),
      duration: elapsed,
      left: 100 * (Date.parse(observation.startTime) - start) / duration,
      width: 100 * elapsed / duration,
    };
  });
}
