import { summarizeTrace, type TraceObservation, type TraceSummary } from './tracing-types';

export interface TaskTraceBundle {
  task_id: string;
  team_id: string;
  queried_at: string;
  retrieval_complete: boolean;
  tasks: { task_id: string; title?: string; status: string; assigned_to?: string; depends_on?: string[] }[];
  traces: { task_id?: string; correlation?: string; trace: TraceSummary; observations: TraceObservation[] }[];
  causal_links: { from_trace_id: string; to_trace_id: string; available: boolean }[];
  gaps: string[];
}

export function summarizeTaskTraces(bundle: TaskTraceBundle) {
  const seen = new Set<string>();
  const traces = bundle.traces.map((entry) => ({ ...entry, observations: entry.observations.filter((o) => {
    const key = `${entry.trace.id}/${o.id}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }) }));
  const observations = traces.flatMap((entry) => entry.observations);
  const summary = summarizeTrace(observations);
  const groups = new Map<string, { name: string; tokens: number; calls: number; reported: number; complete: number; tools: number; failedTools: number }>();
  const runs = new Map<string, { id: string; agent: string; taskId: string; start: number; end: number; traces: typeof traces }>();
  let start = Infinity, end = -Infinity;
  for (const entry of traces) {
    const meta = entry.trace.metadata ?? {};
    const agent = entry.trace.userId || String(meta['agentteams.worker.name'] || meta['gen_ai.agent.id'] || '未识别 Agent');
    const usage = summarizeTrace(entry.observations);
    const group = groups.get(agent) ?? { name: agent, tokens: 0, calls: 0, reported: 0, complete: 0, tools: 0, failedTools: 0 };
    group.tokens += usage.tokens; group.calls += usage.calls.length;
    group.reported += usage.reportedCalls; group.complete += usage.completeCalls;
    const tools = entry.observations.filter((o) => o.type === 'TOOL' || o.metadata?.['gen_ai.operation.name'] === 'execute_tool');
    group.tools += tools.length;
    group.failedTools += tools.filter((o) => o.level === 'ERROR' || o.metadata?.['agentteams.outcome'] === 'error').length;
    groups.set(agent, group);
    const times = [Date.parse(entry.trace.timestamp), ...entry.observations.map((o) => Date.parse(o.startTime))].filter(Number.isFinite);
    const ends = entry.observations.map((o) => Date.parse(o.endTime ?? o.startTime)).filter(Number.isFinite);
    const first = times.length ? Math.min(...times) : null;
    const last = ends.length ? Math.max(...ends, ...(first == null ? [] : [first])) : first;
    if (first == null || last == null) continue;
    start = Math.min(start, first); end = Math.max(end, last);
    const runId = String(meta['agentteams.run.id'] || entry.trace.id);
    const key = `${agent}/${runId}`;
    const run = runs.get(key) ?? { id: key, agent, taskId: String(meta['agentteams.task.id'] || entry.task_id || ''), start: first, end: last, traces: [] };
    run.start = Math.min(run.start, first); run.end = Math.max(run.end, last); run.traces.push(entry);
    runs.set(key, run);
  }
  return { ...summary, start: Number.isFinite(start) ? start : null, end: Number.isFinite(end) ? end : null,
    durationMs: Number.isFinite(start) && Number.isFinite(end) ? end - start : null,
    agents: [...groups.values()].sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name)),
    runs: [...runs.values()].sort((a, b) => a.start - b.start), observationCount: observations.length,
    toolCount: [...groups.values()].reduce((total, agent) => total + agent.tools, 0),
    usageComplete: summary.calls.length > 0 && summary.completeCalls === summary.calls.length,
  };
}

export function traceDuration(ms: number | null) {
  if (ms == null) return '未上报';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} 秒`;
  const minutes = Math.floor(ms / 60000), seconds = Math.floor(ms % 60000 / 1000);
  return `${minutes} 分 ${seconds.toString().padStart(2, '0')} 秒`;
}

/** Read only reasoning text the model actually returned in its native payload. */
export function traceReasoning(output: unknown): string {
  if (typeof output === 'string') {
    if (!/^[\s]*[\[{]/.test(output)) return '';
    try { return traceReasoning(JSON.parse(output)); } catch { return ''; }
  }
  if (Array.isArray(output)) return output.map(traceReasoning).join('');
  if (!output || typeof output !== 'object') return '';
  const value = output as Record<string, unknown>;
  if (['reasoning', 'thinking', 'reasoning-delta', 'reasoning_text', 'summary_text'].includes(String(value.type))) {
    const text = value.thinking ?? value.text ?? value.content;
    if (typeof text === 'string') return text;
  }
  const direct = [value.reasoning_content, value.reasoning].filter((text): text is string => typeof text === 'string').join('');
  return direct + ['content', 'parts', 'stream', 'choices', 'message', 'output', 'summary', 'delta'].map((key) => traceReasoning(value[key])).join('');
}
