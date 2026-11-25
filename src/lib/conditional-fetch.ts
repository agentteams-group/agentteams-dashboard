import { ApiError } from './api-error';
import { useAgentTeamsStore } from './agentteams-store';
import { useMatrixStore } from './matrix-store';
import { loadClientConfig } from './client-config-store';

// Private, memory-only response bodies. Every reuse still requires upstream 304.
const responses = new Map<string, { etag: string; body: string; contentType: string }>();
let scope = '';
let revision = 0;

export function clearConditionalResponses(): void {
  responses.clear();
  revision++;
}

export function currentReadScope(): string {
  const app = useAgentTeamsStore.getState();
  const matrix = useMatrixStore.getState();
  return JSON.stringify([
    app.controllerUrl, app.sessionUser, app.userLevel,
    matrix.homeserver, matrix.userId, matrix.accessToken, matrix.syncGeneration,
    loadClientConfig(),
  ]);
}

function isStableRead(url: string): boolean {
  const parsed = new URL(url, 'http://dashboard');
  const path = parsed.pathname.replace(/\/$/, '');
  return /\/api\/agentteams\/(version|skills|mcps)$/.test(path)
    || (path.endsWith('/api/agentteams/workers') && parsed.searchParams.get('fields') === 'spec');
}

export async function conditionalFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const requestScope = currentReadScope();
  if (scope !== requestScope) {
    clearConditionalResponses();
    scope = requestScope;
  }
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET') {
    clearConditionalResponses();
    try { return await fetch(url, init); }
    finally { clearConditionalResponses(); }
  }
  const requestRevision = revision;
  const stable = typeof window !== 'undefined' && isStableRead(url);
  const cached = stable && init.cache !== 'reload' ? responses.get(url) : undefined;
  const headers = new Headers(init.headers);
  if (cached) headers.set('If-None-Match', cached.etag);
  let response = await fetch(url, { ...init, cache: 'no-store', headers });
  if (currentReadScope() !== requestScope) {
    throw new ApiError('账号或连接已切换，请重新读取', 409, url);
  }
  if (response.status === 304) {
    if (cached && revision === requestRevision && (!response.headers.has('ETag') || response.headers.get('ETag') === cached.etag)) {
      return new Response(cached.body, { headers: { 'Content-Type': cached.contentType } });
    }
    // A lost cache entry or a concurrent write cannot turn 304 into empty data.
    headers.delete('If-None-Match');
    response = await fetch(url, { ...init, cache: 'no-store', headers });
    if (currentReadScope() !== requestScope) throw new ApiError('账号或连接已切换，请重新读取', 409, url);
  }
  if (stable && response.ok && response.headers.get('ETag')) {
    const body = await response.clone().text();
    if (currentReadScope() !== requestScope) throw new ApiError('账号或连接已切换，请重新读取', 409, url);
    if (revision === requestRevision && currentReadScope() === requestScope) {
      if (responses.size >= 64) responses.delete(responses.keys().next().value!);
      responses.set(url, { etag: response.headers.get('ETag')!, body, contentType: response.headers.get('Content-Type') || 'application/json' });
    }
  } else if (stable) {
    responses.delete(url);
  }
  return response;
}
