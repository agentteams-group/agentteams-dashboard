import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '@/app/api/agentteams/proxy-helper';
import { getSessionFromRequest } from './dashboard-session';
import { readServerIdentity } from './server-auth';
import { isStatelessAuthMode } from './static-mode';
import { TracingError } from './langfuse-server';
import type { TraceScope } from './tracing-types';

export async function getTraceScope(request: NextRequest): Promise<TraceScope> {
  const identity = readServerIdentity(request);
  if (!identity) throw new TracingError(401, '请先登录');
  // The isolated demo has no Controller or real organization accounts.
  if (process.env.AGENTTEAMS_TRACING_DEMO === 'true' && process.env.AGENTTEAMS_AUTH_DISABLED === 'true' && identity.level === 3) {
    try {
      const scope = JSON.parse(process.env.AGENTTEAMS_TRACING_DEMO_SCOPE ?? '') as TraceScope;
      if (!Array.isArray(scope.teams) || !Array.isArray(scope.workers) ||
          scope.teams.some((t) => typeof t.name !== 'string' || typeof t.label !== 'string') ||
          scope.workers.some((w) => typeof w.name !== 'string' || typeof w.team !== 'string')) throw new Error();
      return scope;
    } catch { throw new TracingError(503, '隔离演示未配置资源范围'); }
  }
  // Never let proxy-helper's SA fallback upgrade a scoped, session-less request.
  if (identity.level < 3 && !isStatelessAuthMode() && getSessionFromRequest(request)?.credential.kind !== 'matrix') {
    throw new TracingError(401, '请重新登录以确认资源访问范围');
  }
  // Langfuse credentials belong to this deployment, so its Controller is fixed.
  const url = new URL(request.url); url.searchParams.delete('controllerUrl');
  const scopedRequest = new NextRequest(url, { headers: request.headers });
  const controller = getControllerUrl(scopedRequest);
  const [workerResponse, teamResponse] = await Promise.all([
    proxyToAgentTeams(scopedRequest, controller, '/api/v1/workers', { method: 'GET', forwardBody: false }),
    proxyToAgentTeams(scopedRequest, controller, '/api/v1/teams', { method: 'GET', forwardBody: false }),
  ]);
  for (const response of [workerResponse, teamResponse]) {
    if (!response.ok) throw new TracingError([401, 403].includes(response.status) ? response.status : 503, '无法确认当前账号的资源访问范围');
  }
  const workers = (await workerResponse.json()).workers as { name: string; team?: string }[];
  const teams = (await teamResponse.json()).teams as { name: string; teamName?: string }[];
  if (!Array.isArray(workers) || !Array.isArray(teams)) throw new TracingError(503, '资源访问范围响应无效');
  return {
    workers: workers.map((w) => ({ name: w.name, team: w.team ?? '' })).sort((a, b) => a.name.localeCompare(b.name)),
    teams: teams.map((t) => ({ name: t.name, label: t.teamName || t.name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

