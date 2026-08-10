import { NextRequest, NextResponse } from 'next/server';
import { fetchAgentSpec } from '@/lib/agentspec-fetcher';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get('name');
  const version = request.nextUrl.searchParams.get('version');

  if (!name || !version) {
    return NextResponse.json({ error: '缺少 name 或 version 参数' }, { status: 400 });
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    return NextResponse.json({ error: '非法 AgentSpec 名称' }, { status: 400 });
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version)) {
    return NextResponse.json({ error: '非法版本号' }, { status: 400 });
  }

  const result = await fetchAgentSpec(name, version);
  if (!result.ok || !result.mapping) {
    return NextResponse.json({ error: result.error ?? 'AgentSpec 获取失败' }, { status: 502 });
  }

  return NextResponse.json(result.mapping);
}
