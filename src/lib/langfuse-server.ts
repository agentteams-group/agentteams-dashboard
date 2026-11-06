// Server-only Langfuse access. Never expose the project secret to the browser.
import type { TraceDetail, TraceList, TraceScope, TraceSummary } from './tracing-types';
import { traceInScope } from './tracing-scope';
export { traceInScope } from './tracing-scope';
import { readObservabilityConfig } from './observability-config';
import { TracingError } from './tracing-error';
export { TracingError } from './tracing-error';

async function configuration() {
  const settings = await readObservabilityConfig();
  const { langfuseUrl: base, publicKey, secretKey } = settings;
  if (!base || !publicKey || !secretKey) {
    throw new TracingError(503, '尚未配置 Langfuse，请由管理员打开可观测配置完成连接设置。');
  }
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new TracingError(503, 'Langfuse 服务端地址配置无效');
  }
  return { base: base.replace(/\/$/, ''), authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}` };
}

async function query<T>(path: string): Promise<T> {
  const config = await configuration();
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
  const settings = await readObservabilityConfig();
  const publicBase = settings.publicUrl || settings.langfuseUrl;
  const project = settings.projectId;
  let langfuseUrl: string | null = null;
  if (publicBase && project && /^https?:\/\//.test(publicBase)) {
    langfuseUrl = `${publicBase.replace(/\/$/, '')}/project/${encodeURIComponent(project)}/traces/${id}`;
  }
  return { ...result, backend: 'langfuse', backendUrl: langfuseUrl, observations: result.observations.map((observation) => {
    const attributes = observation.metadata?.attributes;
    return { ...observation, metadata: {
      ...(attributes && typeof attributes === 'object' && !Array.isArray(attributes) ? attributes : {}),
      ...observation.metadata,
    } };
  }), langfuseUrl };
}
