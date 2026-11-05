import { NextRequest, NextResponse } from 'next/server';
import { listTraces, TracingError } from '@/lib/langfuse-server';
import { readServerIdentity } from '@/lib/server-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  // Project-wide API credentials: only platform admins may query this project.
  const identity = readServerIdentity(request);
  if (!identity) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  if (identity.level < 3) return NextResponse.json({ error: '仅管理员可以查看 Tracing' }, { status: 403 });
  try {
    return NextResponse.json(await listTraces(request.nextUrl.searchParams));
  } catch (error) {
    return NextResponse.json({ error: error instanceof TracingError ? error.message : 'Tracing 查询失败' },
      { status: error instanceof TracingError ? error.status : 502 });
  }
}
