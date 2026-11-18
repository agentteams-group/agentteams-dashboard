import { NextRequest, NextResponse } from 'next/server';
import { readServerIdentity } from '@/lib/server-auth';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';

export async function POST(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const identity = readServerIdentity(request);
  if (!identity) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  if (identity.level < 3) return NextResponse.json({ error: '仅管理员可以重置用户密码' }, { status: 403 });
  const { name } = await params;
  return proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/humans/${encodeURIComponent(name)}/reset-password`);
}
