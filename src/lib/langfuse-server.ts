// Server-only Langfuse access. Never expose the project secret to the browser.
import type { TraceDetail, TraceList, TraceScope, TraceSummary } from './tracing-types';

export class TracingError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function configuration() {
  const base = process.env.LANGFUSE_BASE_URL;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!base || !publicKey || !secretKey) {
    throw new TracingError(503, '尚未配置 Langfuse。请设置服务端 LANGFUSE_BASE_URL、LANGFUSE_PUBLIC_KEY 和 LANGFUSE_SECRET_KEY。');
  }
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new TracingError(503, 'Langfuse 服务端地址配置无效');
  }
  return { base: base.replace(/\/$/, ''), authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}` };
}

async function query<T>(path: string): Promise<T> {
  const config = configuration();
  let response: Response;
  try {
    response = await fetch(`${config.base}/api/public/${path}`, {
      headers: { Authorization: config.authorization },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new TracingError(502, '无法连接 Langfuse，请检查服务状态');
  }
  if (!response.ok) {
    throw new TracingError(response.status === 404 ? 404 : 502,
      response.status === 404 ? 'Trace 不存在或尚未完成入库' : `Langfuse 查询失败（${response.status}）`);
  }
  return response.json() as Promise<T>;
}

export async function listTraces(search: URLSearchParams, scope: TraceScope): Promise<TraceList> {
  const page = search.get('page') ?? '1';
  if (!/^[1-9]\d{0,4}$/.test(page)) throw new TracingError(400, '无效页码');
  const params = new URLSearchParams({ page, limit: '20', orderBy: 'timestamp.desc', tags: 'agentteams' });
  params.append('tags', 'worker-turn');
  const worker = search.get('worker');
  const team = search.get('team');
  if ((worker && !scope.workers.some((w) => w.name === worker)) ||
      (team && !scope.teams.some((t) => t.name === team))) throw new TracingError(404, '资源不存在或无权访问');
  if (worker) params.set('userId', worker);
  const runtime = search.get('runtime');
  if (runtime) params.append('tags', runtime);
  const task = search.get('task');
  if (task) params.append('tags', `task:${task}`);
  for (const label of ['team', 'room', 'project']) {
    const value = search.get(label);
    if (value) params.append('tags', `${label}:${value}`);
  }
  const session = search.get('session');
  if (session) params.set('sessionId', session);
  const hours = Number(search.get('hours') ?? '24');
  if (![1, 24, 168].includes(hours)) throw new TracingError(400, '无效时间范围');
  if (!session) params.set('fromTimestamp', new Date(Date.now() - hours * 3600000).toISOString());
  const names = scope.workers.filter((w) => (!worker || w.name === worker) && (!team || w.team === team)).map((w) => w.name);
  const visible: TraceSummary[] = [];
  if (names.length) {
    params.set('filter', JSON.stringify([{ type: 'stringOptions', column: 'userId', operator: 'any of', value: names }]));
    // Apply the authoritative Worker/Team relationship before pagination and
    // counts, including sessions and history from reassigned Workers.
    params.set('limit', '100');
    let current = 1;
    let pages = 1;
    do {
      params.set('page', String(current));
      const result = await query<TraceList>(`traces?${params}`);
      visible.push(...result.data.filter((t) => traceInScope(t, scope)));
      pages = result.meta.totalPages; current++;
    } while (current <= pages);
  }
  // Keep input/output out of the list; load content only on explicit selection.
  return { meta: { page: Number(page), totalItems: visible.length, totalPages: Math.ceil(visible.length / 20) },
    data: visible.slice((Number(page) - 1) * 20, Number(page) * 20).map((t) => ({
    id: t.id, name: t.name, timestamp: t.timestamp, userId: t.userId,
    sessionId: t.sessionId, tags: t.tags, metadata: t.metadata,
    latency: t.latency, totalCost: t.totalCost,
  })) };
}

export async function getTrace(id: string, scope: TraceScope): Promise<TraceDetail> {
  if (!/^[a-f0-9]{32}$/i.test(id)) throw new TracingError(400, '无效 Trace ID');
  const result = await query<TraceDetail>(`traces/${encodeURIComponent(id)}`);
  if (!traceInScope(result, scope)) throw new TracingError(404, 'Trace 不存在或无权访问');
  const publicBase = process.env.LANGFUSE_PUBLIC_URL;
  const project = process.env.LANGFUSE_PROJECT_ID;
  let langfuseUrl: string | null = null;
  if (publicBase && project && /^https?:\/\//.test(publicBase)) {
    langfuseUrl = `${publicBase.replace(/\/$/, '')}/project/${encodeURIComponent(project)}/traces/${id}`;
  }
  return { ...result, observations: result.observations.map((observation) => {
    const attributes = observation.metadata?.attributes;
    return { ...observation, metadata: {
      ...(attributes && typeof attributes === 'object' && !Array.isArray(attributes) ? attributes : {}),
      ...observation.metadata,
    } };
  }), langfuseUrl };
}

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
