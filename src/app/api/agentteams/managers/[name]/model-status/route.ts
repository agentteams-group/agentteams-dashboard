import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';

export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/managers/${encodeURIComponent(name)}/model-status`, { forwardBody: false });
}
