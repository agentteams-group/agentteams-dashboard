import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../proxy-helper';
import { getRequestModelAlias, rejectExternalModelProvider, rejectUnavailableExternalModelAlias } from '../../external-model-binding-guard';
import { enforceServerSideRbac } from '@/lib/server-auth';

// GET /api/agentteams/managers/{name}
//
// Proxies the controller `GET /api/v1/managers/{name}` read. The managers list
// is served by the same controller read; this single-object route exists so the
// detail sheet can re-read one Manager after each save (the list projection is
// polled and may lag behind a just-written spec).
export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/managers/${encodeURIComponent(name)}`, {
    forwardBody: false,
    method: 'GET',
  });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const denied = await enforceServerSideRbac(request, 'update', 'team', name);
  if (denied) return denied;
  const providerRejected = await rejectExternalModelProvider(request);
  if (providerRejected) return providerRejected;
  const rejected = await rejectUnavailableExternalModelAlias(request, await getRequestModelAlias(request));
  if (rejected) return rejected;
  return proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/managers/${encodeURIComponent(name)}`);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const denied = await enforceServerSideRbac(request, 'delete', 'team', name);
  if (denied) return denied;
  return proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/managers/${encodeURIComponent(name)}`, { forwardBody: false, method: 'DELETE' });
}
