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
  backend?: 'langfuse' | 'agentloop';
  backendUrl?: string | null;
  observations: TraceObservation[];
  langfuseUrl: string | null;
}

export interface TraceList {
  data: TraceSummary[];
  meta: { page: number; totalPages: number; totalItems: number };
}

export interface TraceScope {
  canConfigure?: boolean;
  tracingConfigured?: boolean;
  tracingEnabled?: boolean;
  teams: { name: string; label: string }[];
  workers: { name: string; team: string; runtime?: string }[];
}

export function summarizeTrace(observations: TraceObservation[]) {
  const calls = observations.filter((o) => o.type === 'GENERATION')
    .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))
    .map((observation, index) => {
      const input = observation.usageDetails?.input ?? observation.usage?.input;
      const output = observation.usageDetails?.output ?? observation.usage?.output;
      const total = observation.usageDetails?.total ?? observation.usage?.total;
      return { observation, index: index + 1, input, output,
        tokens: total ?? ((input ?? 0) + (output ?? 0)),
        reported: total != null || input != null || output != null,
        complete: total != null || (input != null && output != null),
      };
    });
  const models = new Map<string, { model: string; calls: number; tokens: number; complete: boolean }>();
  for (const call of calls) {
    const model = call.observation.model ?? '未知模型';
    const group = models.get(model) ?? { model, calls: 0, tokens: 0, complete: true };
    group.calls++; group.tokens += call.tokens; group.complete &&= call.complete;
    models.set(model, group);
  }
  // Measure the full timeline, rather than summing overlapping parent/child durations.
  const start = Math.min(...observations.map((o) => Date.parse(o.startTime)));
  const end = Math.max(...observations.map((o) => Date.parse(o.endTime ?? o.startTime)));
  return {
    tokens: calls.reduce((sum, c) => sum + c.tokens, 0),
    input: calls.reduce((sum, c) => sum + (c.input ?? 0), 0),
    output: calls.reduce((sum, c) => sum + (c.output ?? 0), 0),
    reportedCalls: calls.filter((c) => c.reported).length,
    completeCalls: calls.filter((c) => c.complete).length,
    breakdownCalls: calls.filter((c) => c.input != null && c.output != null).length,
    durationMs: observations.length ? Math.max(0, end - start) : null,
    durationComplete: observations.every((o) => o.endTime != null),
    calls: calls.sort((a, b) => b.tokens - a.tokens),
    models: [...models.values()].sort((a, b) => b.tokens - a.tokens),
  };
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
