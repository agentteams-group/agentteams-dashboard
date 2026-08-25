import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../proxy-helper';
import { getRequestModelAlias, rejectExternalModelProvider, rejectUnavailableExternalModelAlias } from '../external-model-binding-guard';
import { enforceServerSideRbac } from '@/lib/server-auth';

export async function GET(request: NextRequest) {
  return proxyToAgentTeams(request, getControllerUrl(request), '/api/v1/workers', { forwardBody: false });
}

export async function POST(request: NextRequest) {
  const denied = await enforceServerSideRbac(request, 'create', 'worker', '*');
  if (denied) return denied;
  const providerRejected = await rejectExternalModelProvider(request);
  if (providerRejected) return providerRejected;
  const rejected = await rejectUnavailableExternalModelAlias(request, await getRequestModelAlias(request));
  if (rejected) return rejected;
  return proxyToAgentTeams(request, getControllerUrl(request), '/api/v1/workers');
}
