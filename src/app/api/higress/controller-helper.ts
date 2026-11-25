import { NextRequest } from 'next/server';
import { getSessionFromRequest } from '@/lib/dashboard-session';
import { isStatelessAuthMode } from '@/lib/static-mode';
import { getControllerUrl, proxyToAgentTeams } from '../agentteams/proxy-helper';
import { callHigressConsole, isFallbackConfigWriteEnabled, prepareAiRoutePayload } from './proxy-helper';
import { getSessionCookie, isRecord } from './helpers';

/**
 * Controller statuses that mean "this deployment's Controller does not serve
 * the AI catalog" rather than "the caller is not allowed". Only these may be
 * answered by the Higress Console; 401/403 stay visible (login/permission
 * failures must not be masked) and 5xx stays visible (a real upstream fault
 * must not be disguised as a Console success).
 */
const CONSOLE_FALLBACK_STATUSES = new Set([404, 405, 501]);

async function callConsoleGateway(
  request: NextRequest,
  path: string,
  options: { method?: string; body?: string | Record<string, unknown> },
): Promise<{ response: Response; body: unknown }> {
  const body = path.startsWith('/v1/ai/routes') && isRecord(options.body)
    ? prepareAiRoutePayload(options.body) : options.body;
  const result = await callHigressConsole(path, {
    method: options.method ?? 'GET',
    body,
    cookie: getSessionCookie(request),
  });
  if (path === '/v1/ai/routes' && isRecord(result.body)) {
    result.body.fallbackConfigWritable = isFallbackConfigWriteEnabled();
  }
  return result;
}

/** Keep the UI response contract while Controller owns downstream credentials. */
export async function callControllerGateway(
  request: NextRequest,
  path: string,
  options: { method?: string; body?: string | Record<string, unknown> } = {},
): Promise<{ response: Response; body: unknown }> {
  const asset = /^\/assets\/(models|mcps)$/.test(path);
  if (!asset && !/^\/v1\/ai\/(providers|routes)(\/[^/]+)?$/.test(path)) throw new Error('Unsupported gateway operation');
  // External Console-only installations have no Human/Controller login chain.
  if (process.env.AGENTTEAMS_HIGRESS_ADAPTER_MODE === 'external') {
    if (asset) return { response: Response.json({ error: 'Controller asset management unavailable' }, { status: 501 }), body: null };
    return callConsoleGateway(request, path, options);
  }
  // Provider save and managed-route synchronization are one Controller
  // operation. Older Controllers retain their existing UI/Console path.
  if (/^\/v1\/ai\/providers(\/[^/]+)?$/.test(path) && ['POST', 'PUT'].includes(options.method ?? '') && isRecord(options.body)) {
    const managed = await callControllerAsset(request, 'models', { action: 'save', input: options.body, update: options.method === 'PUT' });
    if (managed) return managed.response.ok
      ? { response: managed.response, body: { data: { ...options.body, ...(isRecord(managed.body) ? managed.body : {}), gatewayManaged: true } } }
      : managed;
  }
  const session = getSessionFromRequest(request);
  const token = isStatelessAuthMode()
    ? request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    : session?.credential.kind === 'matrix' || session?.credential.kind === 'controller-token'
      ? session.credential.token : undefined;
  // An 'sa' session is the legacy admin-password login: the Controller
  // credential is the server-side SA (AGENTTEAMS_AUTH_TOKEN / token file),
  // resolved by proxyToAgentTeams — the browser never holds it.
  const isServerSaSession = session?.credential.kind === 'sa';
  if (!token && !isServerSaSession) throw new Error('A Controller user credential is required');
  const headers = new Headers(request.headers);
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  } else {
    // Let proxyToAgentTeams inject the server SA. Drop any browser-supplied
    // Authorization so it can never be mistaken for the user's credential.
    headers.delete('authorization');
  }
  headers.set('content-type', 'application/json');
  const method = options.method ?? 'GET';
  const forwarded = new NextRequest(request.url, {
    method, headers,
    ...(options.body !== undefined ? { body: typeof options.body === 'string' ? options.body : JSON.stringify(options.body) } : {}),
  });
  const controllerPath = asset ? `/api/v1/gateway${path}` : path.replace('/v1/ai/', '/api/v1/gateway/ai/');
  const response = await proxyToAgentTeams(forwarded, getControllerUrl(request), controllerPath, { method });
  const body: unknown = await response.clone().json().catch(() => null);
  // Modern Controllers own the AI catalog; deployments whose Controller does
  // not implement it (plain 404/405/501) are served by their Higress Console
  // instead. The Console call is the ONLY fallback path in the dashboard.
  if (!asset && !response.ok && CONSOLE_FALLBACK_STATUSES.has(response.status)) {
    return callConsoleGateway(request, path, options);
  }
  return { response, body };
}

/** Null means this deployment lacks the Controller asset capability. Auth,
 * validation and upstream failures stay visible and never trigger a fallback. */
export async function callControllerAsset(request: NextRequest, asset: 'models' | 'mcps', body?: Record<string, unknown>) {
  const result = await callControllerGateway(request, `/assets/${asset}`, { method: body ? 'POST' : 'GET', body });
  const resourceFailure = isRecord(result.body) && result.body.fallbackAllowed === false;
  return CONSOLE_FALLBACK_STATUSES.has(result.response.status) && !resourceFailure ? null : result;
}
