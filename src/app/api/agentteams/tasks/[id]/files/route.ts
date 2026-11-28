import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const query = new URLSearchParams();
  for (const key of ['team', 'name', 'artifactId', 'version']) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) query.set(key, value);
  }
  return proxyToAgentTeams(request, getControllerUrl(request), `/api/v1/tasks/${encodeURIComponent(id)}/files?${query}`, {
    forwardBody: false, stream: true, passthroughHeaders: ['content-disposition', 'content-length'],
  });
}
