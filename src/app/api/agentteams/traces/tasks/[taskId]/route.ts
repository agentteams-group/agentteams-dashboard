import { NextRequest, NextResponse } from 'next/server';
import { readServerIdentity } from '@/lib/server-auth';
import { observabilityController } from '@/lib/observability-controller';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, context: { params: Promise<{ taskId: string }> }) {
  if (!readServerIdentity(request)) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const { taskId } = await context.params;
  const query = new URLSearchParams();
  const team = request.nextUrl.searchParams.get('team');
  if (team) query.set('team', team);
  return observabilityController(request, `/api/v1/tasks/${encodeURIComponent(taskId)}/traces?${query}`, 'GET', undefined, 90000);
}
