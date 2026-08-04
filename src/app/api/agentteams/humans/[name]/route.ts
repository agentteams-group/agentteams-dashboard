import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../proxy-helper';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/humans/${encodeURIComponent(name)}`);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/humans/${encodeURIComponent(name)}`, { forwardBody: false, method: 'DELETE' });
}
