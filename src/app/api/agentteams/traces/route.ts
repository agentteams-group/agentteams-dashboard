import { NextRequest, NextResponse } from 'next/server';
import { listTraces, TracingError } from '@/lib/tracing-server';
import { readServerIdentity } from '@/lib/server-auth';
import { getTraceScope } from '@/lib/tracing-access';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const identity = readServerIdentity(request);
  if (!identity) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  try {
    const scope = await getTraceScope(request);
    if (request.nextUrl.searchParams.get('options') === 'resources') return NextResponse.json({ ...scope, canConfigure: identity.level === 3 });
    return NextResponse.json(await listTraces(request.nextUrl.searchParams, scope));
  } catch (error) {
    return NextResponse.json({ error: error instanceof TracingError ? error.message : 'Tracing 查询失败' },
      { status: error instanceof TracingError ? error.status : 502 });
  }
}
