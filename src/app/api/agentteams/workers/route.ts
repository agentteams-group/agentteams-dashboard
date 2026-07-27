import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../proxy-helper';
import { getRequestModelAlias, rejectUnavailableExternalModelAlias } from '../external-model-binding-guard';

export async function GET(request: NextRequest) {
  return proxyToAgentTeams(request, getControllerUrl(request), '/api/v1/workers', { forwardBody: false });
}

export async function POST(request: NextRequest) {
  const rejected = await rejectUnavailableExternalModelAlias(request, await getRequestModelAlias(request));
  if (rejected) return rejected;
  return proxyToAgentTeams(request, getControllerUrl(request), '/api/v1/workers');
}
