import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../proxy-helper';
import { enforceServerSideRbac } from '@/lib/server-auth';

export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/humans/${encodeURIComponent(name)}`, {
    forwardBody: false,
    method: 'GET',
  });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const denied = await enforceServerSideRbac(request, 'update', 'team', name);
  if (denied) return denied;
  return proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/humans/${encodeURIComponent(name)}`);
}

// Merge-patch fallback for the spec-object fields (modelAccess /
// workspaceAccess) on controllers whose PUT /humans/{name} is missing.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const denied = await enforceServerSideRbac(request, 'update', 'team', name);
  if (denied) return denied;
  return proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/humans/${encodeURIComponent(name)}`, {
    method: 'PATCH',
  });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const denied = await enforceServerSideRbac(request, 'delete', 'team', name);
  if (denied) return denied;
  return proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/humans/${encodeURIComponent(name)}`, { forwardBody: false, method: 'DELETE' });
}
