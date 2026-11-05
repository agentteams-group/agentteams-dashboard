// Server-only Langfuse access. Never expose the project secret to the browser.
import type { TraceDetail, TraceList } from './tracing-types';

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

export async function listTraces(search: URLSearchParams): Promise<TraceList> {
  const page = search.get('page') ?? '1';
  if (!/^[1-9]\d{0,4}$/.test(page)) throw new TracingError(400, '无效页码');
  const params = new URLSearchParams({ page, limit: '20', orderBy: 'timestamp.desc', tags: 'agentteams' });
  params.append('tags', 'worker-turn');
  const worker = search.get('worker');
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
  const result = await query<TraceList>(`traces?${params}`);
  // Keep input/output out of the list; load content only on explicit selection.
  return { meta: result.meta, data: result.data.map((t) => ({
    id: t.id, name: t.name, timestamp: t.timestamp, userId: t.userId,
    sessionId: t.sessionId, tags: t.tags, metadata: t.metadata,
    latency: t.latency, totalCost: t.totalCost,
  })) };
}

export async function getTrace(id: string): Promise<TraceDetail> {
  if (!/^[a-f0-9]{32}$/i.test(id)) throw new TracingError(400, '无效 Trace ID');
  const result = await query<TraceDetail>(`traces/${encodeURIComponent(id)}`);
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
