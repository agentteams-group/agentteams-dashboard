import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';
import { enforceLevelOnlyRbac } from '@/lib/server-auth';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const denied = await enforceLevelOnlyRbac(request, 'delete', 'gateway.consumer', id);
  if (denied) return denied;
  return proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/gateway/consumers/${encodeURIComponent(id)}`, { forwardBody: false, method: 'DELETE' });
}
