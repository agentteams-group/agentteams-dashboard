import { NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/dashboard-session';
import { isStatelessAuthMode } from '@/lib/static-mode';
import { getControllerUrl, proxyToAgentTeams } from '../agentteams/proxy-helper';
import { callHigressConsole, isFallbackConfigWriteEnabled, prepareAiRoutePayload } from './proxy-helper';
import { getSessionCookie, isRecord } from './helpers';

/** Keep the UI response contract while Controller owns downstream credentials. */
export async function callControllerGateway(
  request: NextRequest,
  path: string,
  options: { method?: string; body?: string | Record<string, unknown>; cookie?: string | null } = {},
): Promise<{ response: Response; body: unknown }> {
  if (!/^\/v1\/ai\/(providers|routes)(\/[^/]+)?$/.test(path)) throw new Error('Unsupported gateway operation');
  // External Console-only installations have no Human/Controller login chain.
  if (process.env.AGENTTEAMS_HIGRESS_ADAPTER_MODE === 'external') {
    const body = path.startsWith('/v1/ai/routes') && isRecord(options.body)
      ? prepareAiRoutePayload(options.body) : options.body;
    const result = await callHigressConsole(path, { ...options, body, cookie: getSessionCookie(request) });
    if (path === '/v1/ai/routes' && isRecord(result.body)) {
      result.body.fallbackConfigWritable = isFallbackConfigWriteEnabled();
    }
    return result;
  }
  const session = getSessionFromRequest(request);
  const token = isStatelessAuthMode()
    ? request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    : session?.credential.kind === 'matrix' || session?.credential.kind === 'controller-token'
      ? session.credential.token : undefined;
  if (!token) throw new Error('A Controller user credential is required');
  const headers = new Headers(request.headers);
  headers.set('authorization', `Bearer ${token}`);
  headers.set('content-type', 'application/json');
  const method = options.method ?? 'GET';
  const forwarded = new NextRequest(request.url, {
    method, headers,
    ...(options.body !== undefined ? { body: typeof options.body === 'string' ? options.body : JSON.stringify(options.body) } : {}),
  });
  const response = await proxyToAgentTeams(forwarded, getControllerUrl(request), path.replace('/v1/ai/', '/api/v1/gateway/ai/'), { method });
  const body: unknown = await response.clone().json().catch(() => null);
  return { response, body };
}
