import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';
import { rejectUnavailableExternalWorkerAlias } from '../../../external-model-binding-guard';

export async function POST(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const controllerUrl = getControllerUrl(request);
  const rejected = await rejectUnavailableExternalWorkerAlias(request, controllerUrl, name);
  if (rejected) return rejected;
  return proxyToAgentTeams(request, controllerUrl, `/api/v1/workers/${encodeURIComponent(name)}/ensure-ready`, { forwardBody: false, method: 'POST' });
}
