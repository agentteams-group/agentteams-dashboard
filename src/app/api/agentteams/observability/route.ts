import { NextRequest, NextResponse } from 'next/server';
import { readServerIdentity } from '@/lib/server-auth';
import { getTraceScope } from '@/lib/tracing-access';
import { appendAuditEvent } from '@/lib/audit-log';
import { getControllerUrl, proxyToAgentTeams } from '../proxy-helper';
import { TracingError } from '@/lib/tracing-error';
import { mergeObservabilityConfig, publicObservabilityConfig, readObservabilityConfig, saveObservabilityConfig, testObservabilityConnection, workerObservabilityEnv } from '@/lib/observability-config';

export const runtime = 'nodejs';

function requireAdmin(request: NextRequest) {
  const identity = readServerIdentity(request);
  if (!identity) throw new TracingError(401, '请先登录');
  if (identity.level !== 3) throw new TracingError(403, '仅管理员可以配置可观测');
  return identity;
}

function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof TracingError ? error.message : '可观测操作失败' },
    { status: error instanceof TracingError ? error.status : 502 });
}

export async function GET(request: NextRequest) {
  try { requireAdmin(request); return NextResponse.json(publicObservabilityConfig(await readObservabilityConfig())); }
  catch (error) { return failure(error); }
}

export async function PUT(request: NextRequest) {
  try {
    const identity = requireAdmin(request);
    const config = mergeObservabilityConfig(await readObservabilityConfig(), await request.json());
    const saved = await saveObservabilityConfig(config);
    void appendAuditEvent({ actor: identity.name, actor_level: identity.level, entity_type: 'system', entity_name: 'observability',
      action: 'observability.configure', details: `enabled=${saved.enabled}; mode=${saved.mode}; revision=${saved.revision}`, severity: 'info' });
    return NextResponse.json(publicObservabilityConfig(saved));
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    requireAdmin(request);
    const body = await request.json();
    const saved = await readObservabilityConfig();
    if (body.action === 'test') return NextResponse.json(await testObservabilityConnection(mergeObservabilityConfig(saved, body.settings)));
    if (body.action !== 'apply' || !Array.isArray(body.workers) || body.workers.length < 1 || body.workers.length > 50 ||
        body.workers.some((w: unknown) => typeof w !== 'string')) throw new TracingError(400, '请选择要应用配置的 Worker（最多 50 个）');
    if (body.revision !== saved.revision || saved.revision === 'environment') throw new TracingError(409, '配置已变化，请先保存或重新读取配置');
    const scope = await getTraceScope(request);
    const names = [...new Set<string>(body.workers)];
    if (names.some((name) => !scope.workers.some((w) => w.name === name))) throw new TracingError(404, 'Worker 不存在或无权访问');
    const url = new URL(request.url); url.search = '';
    const scoped = new NextRequest(url, { headers: request.headers });
    const controller = getControllerUrl(scoped);
    const results = [];
    for (const name of names) {
      try {
        const resourcePath = `/api/v1/workers/${encodeURIComponent(name)}`;
        const current = await proxyToAgentTeams(scoped, controller, resourcePath, { method: 'GET', forwardBody: false });
        if (!current.ok) throw new TracingError(502, `读取 Worker 失败（HTTP ${current.status}）`);
        const worker = await current.json();
        if (!['qwenpaw', 'hermes'].includes(worker.runtime)) throw new TracingError(400, '当前运行时尚未完成采集适配');
        if (worker.containerManaged !== true || worker.envEditable !== true) throw new TracingError(400, '需要托管 Worker 和支持环境变量编辑的 Controller');
        const env = workerObservabilityEnv(saved, worker.env ?? {});
        const headers = new Headers(request.headers); headers.set('content-type', 'application/json');
        const update = new NextRequest(url, { method: 'PUT', headers, body: JSON.stringify({ env }) });
        const response = await proxyToAgentTeams(update, controller, resourcePath, { method: 'PUT' });
        if (!response.ok) throw new TracingError(502, `保存 Worker 配置失败（HTTP ${response.status}）`);
        results.push({ name, success: true, revision: saved.revision, message: '配置已下发；托管容器将在重建后生效。' });
      } catch (error) { results.push({ name, success: false, message: error instanceof TracingError ? error.message : 'Worker 配置下发失败' }); }
    }
    return NextResponse.json({ results });
  } catch (error) { return failure(error); }
}
