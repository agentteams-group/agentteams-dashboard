import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';
import { enforceServerSideRbac } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

// GET /api/agentteams/humans/{name}/quota → controller GET /api/v1/humans/{name}/quota
// { usedBytes, quotaBytes|null }；quotaBytes null = 无限制。
export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    `/api/v1/humans/${encodeURIComponent(name)}/quota`,
    { forwardBody: false, method: 'GET' },
  );
}

// PUT /api/v1/humans/{name}/quota — admin only（controller 侧 403）：
// { quotaBytes: N } 设配额，{ quotaBytes: null } 清除（无限制）。
export async function PUT(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const denied = await enforceServerSideRbac(request, 'update', 'team', name);
  if (denied) return denied;
  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    `/api/v1/humans/${encodeURIComponent(name)}/quota`,
  );
}
