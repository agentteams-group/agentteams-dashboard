import { rejectEnvironmentWrite, filterEnvironmentResponse } from "./environment-access";
import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../proxy-helper';
import { getRequestModelAlias, rejectExternalModelProvider, rejectUnavailableExternalModelAlias } from '../external-model-binding-guard';
import { enforceServerSideRbac } from '@/lib/server-auth';

export async function GET(request: NextRequest) {
  return filterEnvironmentResponse(request, await proxyToAgentTeams(request, getControllerUrl(request), '/api/v1/workers', { forwardBody: false }));
}

export async function POST(request: NextRequest) {
  const envDenied = await rejectEnvironmentWrite(request);
  if (envDenied) return envDenied;
  const denied = await enforceServerSideRbac(request, 'create', 'worker', '*');
  if (denied) return denied;
  const providerRejected = await rejectExternalModelProvider(request);
  if (providerRejected) return providerRejected;
  const rejected = await rejectUnavailableExternalModelAlias(request, await getRequestModelAlias(request));
  if (rejected) return rejected;
  return filterEnvironmentResponse(request, await proxyToAgentTeams(request, getControllerUrl(request), '/api/v1/workers'));
}
