import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '@/app/api/agentteams/proxy-helper';
import { rejectEnvironmentWrite, filterEnvironmentResponse } from '../../../environment-access';
import { enforceServerSideRbac } from '@/lib/server-auth';
import { isValidNameSegment } from '@/lib/skill-package';

/** Atomic Controller append; 404/405 lets the client use its ETag fallback. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!isValidNameSegment(name)) {
    return Response.json({ error: '非法 Worker 名' }, { status: 400 });
  }
  const envDenied = await rejectEnvironmentWrite(request);
  if (envDenied) return envDenied;
  const denied = await enforceServerSideRbac(request, 'update', 'worker', name);
  if (denied) return denied;
  return filterEnvironmentResponse(request, await proxyToAgentTeams(
    request,
    getControllerUrl(request),
    `/api/v1/workers/${encodeURIComponent(name)}/skills/append`,
    { method: 'POST', passthroughHeaders: ['etag'] },
  ));
}
