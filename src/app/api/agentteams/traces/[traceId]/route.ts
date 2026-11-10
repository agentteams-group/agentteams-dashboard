import { NextRequest, NextResponse } from 'next/server';
import { TracingError } from '@/lib/tracing-error';
import { controllerObservabilityConfig, observabilityController } from '@/lib/observability-controller';
import { readServerIdentity } from '@/lib/server-auth';
import { getTraceScope } from '@/lib/tracing-access';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, context: { params: Promise<{ traceId: string }> }) {
  const identity = readServerIdentity(request);
  if (!identity) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  try {
    const scope = await getTraceScope(request);
    const { traceId } = await context.params;
    const config = await controllerObservabilityConfig(request);
    if (config.backend !== 'agentloop') return observabilityController(request, `/api/v1/traces/${encodeURIComponent(traceId)}`);
    const { getTrace } = await import('@/lib/agentloop-server');
    const result = await getTrace(traceId, scope, config);
    return NextResponse.json({ ...result, backendUrl: identity.level >= 3 ? result.backendUrl : null, langfuseUrl: identity.level >= 3 ? result.langfuseUrl : null });
  } catch (error) {
    return NextResponse.json({ error: error instanceof TracingError ? error.status === 404 ? 'Trace 不存在或无权访问' : error.message : 'Tracing 查询失败' },
      { status: error instanceof TracingError ? error.status : 502 });
  }
}
