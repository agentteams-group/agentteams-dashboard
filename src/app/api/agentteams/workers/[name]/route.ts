import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../proxy-helper';
import { getRequestModelAlias, rejectExternalModelProvider, rejectUnavailableExternalModelAlias } from '../../external-model-binding-guard';

// GET /api/agentteams/workers/{name}
//
// Proxies the AgentTeams controller `GET /api/v1/workers/{name}` endpoint.
// Needed for the spec.skills merge path: `useUploadWorkerSkill` re-reads the
// worker via `agentteamsApi.getWorker` before issuing the PUT so concurrent
// spec edits from other Dashboard sessions aren't clobbered. Without this
// proxy, Next.js returns 405 before the request reaches the controller.
export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return proxyToAgentTeams(
    request,
    getControllerUrl(request),
    `/api/v1/workers/${encodeURIComponent(name)}`,
    { forwardBody: false },
  );
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const providerRejected = await rejectExternalModelProvider(request);
  if (providerRejected) return providerRejected;
  const rejected = await rejectUnavailableExternalModelAlias(request, await getRequestModelAlias(request));
  if (rejected) return rejected;
  return proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/workers/${encodeURIComponent(name)}`);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/workers/${encodeURIComponent(name)}`, { forwardBody: false, method: 'DELETE' });
}
