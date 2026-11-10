import { NextRequest } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '@/app/api/agentteams/proxy-helper';
import { TracingError } from './tracing-error';
import type { ObservabilityConfig } from './observability-config';

// Forward the caller's credential to the fixed Controller deployment.
export async function observabilityController(request: NextRequest, resource: string, method = 'GET', body?: unknown) {
  const url = new URL(request.url); url.searchParams.delete('controllerUrl');
  const headers = new Headers(request.headers);
  if (body !== undefined) headers.set('content-type', 'application/json');
  const scoped = new NextRequest(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return proxyToAgentTeams(scoped, getControllerUrl(scoped), resource, { method, forwardBody: body !== undefined, timeoutMs: 30000 });
}

export async function controllerObservabilityConfig(request: NextRequest): Promise<ObservabilityConfig> {
  const response = await observabilityController(request, '/api/v1/observability/config');
  if (!response.ok) throw new TracingError(response.status, '无法读取 Controller 可观测配置');
  return { ...await response.json(), secretKey: '', collectorHeaders: '' };
}
