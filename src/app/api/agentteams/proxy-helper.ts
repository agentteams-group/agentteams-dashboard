// Shared proxy helper for AgentTeams API routes
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/dashboard-session';
import { backendAuthHeader, markWorking, orderedCandidates, pickBackendUrl } from '@/lib/backend-config';
import { appendAuditEvent } from '@/lib/audit-log';
import { readServerIdentity } from '@/lib/server-auth';
import { isStatelessAuthMode } from '@/lib/static-mode';
import { createHash } from 'node:crypto';

const TIMEOUT_MS = 10000;
// Request-layer failover (plugin catch-all parity): a transport error retries
// the SAME address once after this backoff before walking to the next
// candidate. An HTTP response — including 4xx/5xx — means the address is up
// and is returned as-is (never retried); only status < 400 marks it working.
const SAME_ADDRESS_RETRY_MS = 300;
const SAME_ADDRESS_RETRIES = 1;

// Allowed controller URL hosts to prevent SSRF (only applies to user-supplied ?controllerUrl=)
// In production/k3s mode the env var AGENTTEAMS_CONTROLLER_URL is authoritative.
const ALLOWED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'agentteams-controller',
  'agentteams-controller.agentteams-system',
  'agentteams-controller.agentteams-system.svc',
  'agentteams-controller.agentteams-system.svc.cluster.local',
];

async function readAuthTokenFromFile(path: string): Promise<string | undefined> {
  try {
    // Use dynamic import so this code can still run in non-Node environments (e.g. tests)
    const fs = await import('node:fs');
    return fs.readFileSync(path, 'utf-8').trim();
  } catch {
    return undefined;
  }
}

export async function getAuthToken(): Promise<string | undefined> {
  // Do NOT cache: projected service-account tokens rotate (e.g. every 3600s).
  // Re-read on every call so we never send a stale token to the controller.
  return (
    process.env.AGENTTEAMS_AUTH_TOKEN ||
    (process.env.AGENTTEAMS_AUTH_TOKEN_FILE
      ? await readAuthTokenFromFile(process.env.AGENTTEAMS_AUTH_TOKEN_FILE)
      : undefined)
  );
}

function getDefaultControllerUrl(): string {
  // F1 resolution: first-launch config file (dual address + failover) >
  // env vars > embedded in-cluster default. pickBackendUrl also returns the
  // last-known-working address while its probe TTL is fresh, so a flaky
  // primary automatically falls back to the secondary.
  const configured = pickBackendUrl('controller');
  if (configured) return configured;
  // Default to the in-cluster service name so a missing env var does not
  // cause the dashboard to proxy to itself on localhost.
  return process.env.AGENTTEAMS_API_URL || 'http://agentteams-controller:8090';
}

/** A valid ?controllerUrl= override for this request (L1 / pre-login,
 * SSRF-checked), or null when absent / invalid / not allowed.
 *
 * F1b: the per-request override is L1-only. An L2 (own-scope, Matrix
 * credential) session must always hit the deployment-configured controller so
 * the A2 self-scope chain and audit attribution stay intact — a redirected
 * request would land on a controller that has no notion of this user's scope.
 * Pre-login requests (login flow, public setup endpoints) keep the override
 * behind the SSRF allowlist as before. Level 3 sessions are exactly the
 * admin-credential sessions ('sa' / 'controller-token' — see the login
 * route's credential selection).
 */
export function getControllerOverride(request: NextRequest): string | null {
  const url = request.nextUrl.searchParams.get('controllerUrl');
  if (!url) return null;
  const session = getSessionFromRequest(request);
  if (session && session.level < 3) return null;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (
      !ALLOWED_HOSTS.includes(parsed.hostname) &&
      !parsed.hostname.endsWith('.svc') &&
      !parsed.hostname.endsWith('.svc.cluster.local') &&
      !parsed.hostname.endsWith('.cluster.local') &&
      !parsed.hostname.endsWith('.local')
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function getControllerUrl(request: NextRequest): string {
  const override = getControllerOverride(request);
  if (override) return override;
  return getDefaultControllerUrl();
}

// ── Server-side audit for proxied mutations ─────────────────────────────
// Every Controller write flows through proxyToAgentTeams, so hooking here
// gives the audit page full coverage of dashboard-initiated mutations with
// server-resolved identity (no client trust). Failures are fire-and-forget.

const AUDITED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const METHOD_ACTION: Record<string, string> = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};
const AUDIT_ENTITY_TYPES: Record<string, 'worker' | 'team' | 'manager' | 'human'> = {
  workers: 'worker',
  teams: 'team',
  managers: 'manager',
  humans: 'human',
};
// POST routes that are diagnostics / one-shot probes rather than governance
// mutations — recording them would drown the audit log in noise.
const AUDIT_PATH_DENYLIST = ['/probe', '/presign', '/test', '/ensure-ai', '/login', '/status'];

function auditMutationFromPath(
  path: string,
  method: string,
): { entity_type: 'worker' | 'team' | 'manager' | 'human' | 'system'; entity_name: string; action: string } | null {
  if (!AUDITED_METHODS.has(method)) return null;
  if (AUDIT_PATH_DENYLIST.some((fragment) => path.includes(fragment))) return null;

  const segments = path.split('/').filter(Boolean);
  const entityIdx = segments.findIndex((s) => AUDIT_ENTITY_TYPES[s] !== undefined);
  const entityType = entityIdx >= 0 ? AUDIT_ENTITY_TYPES[segments[entityIdx]] : 'system';
  const rest = entityIdx >= 0 ? segments.slice(entityIdx + 1) : [];
  // /api/v1/workers/{id}/wake → entity {id}, action wake
  // /api/v1/workers (create)   → entity {path}, action create
  const resourceName = rest[0] && !AUDITED_METHODS.has(rest[0]) ? rest[0] : path;
  const action = rest.length > 1 ? rest[rest.length - 1] : (METHOD_ACTION[method] ?? method.toLowerCase());
  return { entity_type: entityType, entity_name: resourceName, action };
}

export function auditProxiedMutation(request: NextRequest, path: string, method: string, upstreamStatus: number): void {
  const mutation = auditMutationFromPath(path, method);
  if (!mutation) return;
  const identity = readServerIdentity(request);
  if (!identity) return; // pre-login flows carry no auditable identity
  void appendAuditEvent({
    actor: identity.name,
    actor_level: identity.level,
    entity_type: mutation.entity_type,
    entity_name: mutation.entity_name,
    action: mutation.action,
    details: `${method} ${path} → upstream ${upstreamStatus}`,
    severity: upstreamStatus < 400 ? 'info' : 'warning',
    source_ip: identity.sourceIp,
  });
}

/**
 * Failover target set for the proxy fetch loop (plugin catch-all parity):
 * an explicit override pins a single address; otherwise the working-first
 * candidate order (fresh working address → config internal → external → env).
 */
export function proxyTargets(request: NextRequest, primary: string): string[] {
  const override = getControllerOverride(request);
  if (override) return [override];
  const candidates = orderedCandidates('controller');
  if (primary && !candidates.includes(primary)) candidates.unshift(primary);
  return candidates.length > 0 ? candidates : [primary];
}

export async function proxyToAgentTeams(
  request: NextRequest,
  controllerUrl: string,
  path: string,
  options: {
    method?: string;
    forwardBody?: boolean;
    contentType?: string;
    /** Stream the upstream body instead of buffering into memory
     * (large binary downloads, e.g. artifact files). */
    stream?: boolean;
    /** Extra response headers to pass through to the client (e.g.
     * 'content-disposition' for binary download routes). Only these are
     * forwarded; everything else is filtered. */
    passthroughHeaders?: string[];
    /** Version read by a caller editing a conditional-write endpoint. */
    ifMatch?: string | null;
  } = {}
): Promise<NextResponse> {
  const { method = request.method, forwardBody = true, contentType } = options;
  // F1c: walk the candidate set instead of a single URL — a dead first
  // candidate must never 502 the data plane (plugin catch-all parity).
  const targets = proxyTargets(request, controllerUrl);

  const fetchOptions: RequestInit = {
    method,
    headers: {},
  };
  if (options.ifMatch) {
    (fetchOptions.headers as Record<string, string>)['If-Match'] = options.ifMatch;
  }

  // Per-session Controller credential (M19 dual-track):
  // - L2 session → the user's own Matrix access token, held in the
  //   server-side session store (A2 chain scopes the request to the user's
  //   teams; token never touches the browser).
  // - L1 session / AUTH_DISABLED → the admin SA token.
  // When a server-side credential exists, NEVER trust the browser-supplied
  // Authorization header (token-injection protection, upstream #89). The
  // browser header is only a fallback when no server-side credential exists
  // at all (legacy dev setups).
  // F7 stateless mode: the browser bearer token IS the credential — the
  // client decides which one to present (its Matrix token, or its optional
  // Controller admin token for the L1 view). There is no server session, and
  // a server-side SA env token must NOT shadow the user's chosen credential
  // (that would silently upgrade a scoped L2 request to full admin). The
  // Controller applies native per-token RBAC on this bearer either way.
  if (isStatelessAuthMode()) {
    const browserAuth = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (browserAuth) {
      (fetchOptions.headers as Record<string, string>)['authorization'] = `Bearer ${browserAuth}`;
    }
  } else {
    const session = getSessionFromRequest(request);
    const sessionToken =
      session?.credential.kind === 'matrix' || session?.credential.kind === 'controller-token'
        ? session.credential.token
        : undefined;
    const saToken = await getAuthToken();
    const authToken = sessionToken || saToken || (
      request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || undefined
    );
    if (authToken) {
      (fetchOptions.headers as Record<string, string>)['authorization'] = `Bearer ${authToken}`;
    }
  }

  // Forward the server-resolved identity (set by middleware from the
  // dashboard session) so the controller can attribute write actions to the
  // right user without trusting browser-supplied headers.
  for (const name of ['x-agentteams-user', 'x-agentteams-user-level']) {
    const value = request.headers.get(name);
    if (value) (fetchOptions.headers as Record<string, string>)[name] = value;
  }

  try {
    if (forwardBody && ['POST', 'PUT', 'PATCH'].includes(method)) {
      if (contentType === 'multipart/form-data') {
        // Forward multipart as-is (don't set Content-Type, let fetch handle boundary)
        const body = await request.arrayBuffer();
        fetchOptions.body = body;
        // Copy the content-type header from the original request
        const origCT = request.headers.get('content-type');
        if (origCT) {
          (fetchOptions.headers as Record<string, string>)['content-type'] = origCT;
        }
      } else {
        fetchOptions.body = await request.text();
        (fetchOptions.headers as Record<string, string>)['content-type'] = 'application/json';
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to read request body';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Failover loop: for each candidate address, try up to SAME_ADDRESS_RETRIES
  // extra times on the SAME address (300ms backoff) before walking on. An HTTP
  // response — any status — means the address is up: return it as-is.
  const failures: Array<{ url: string; error: string }> = [];
  for (const target of targets) {
    let targetUrl: string;
    try {
      targetUrl = new URL(path, target).toString();
    } catch {
      failures.push({ url: target, error: 'invalid controller URL' });
      continue;
    }
    for (let attempt = 0; attempt <= SAME_ADDRESS_RETRIES; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const parsed = new URL(targetUrl);
        const conditionalRead = method === 'GET' && !options.stream && (
          ['/api/v1/version', '/api/v1/skills', '/api/v1/mcp-servers', '/api/v1/gateway/ai-routes'].includes(parsed.pathname)
          || (parsed.pathname === '/api/v1/workers' && parsed.searchParams.get('fields') === 'spec')
        );
        // Scope validators to the effective server credential, identity and target.
        // A browser cannot replay an admin body's validator after switching account.
        const identity = readServerIdentity(request);
        const validatorScope = createHash('sha256').update(JSON.stringify([
          targetUrl, fetchOptions.headers, identity?.name, identity?.level,
        ])).digest('hex').slice(0, 32);
        const upstreamHeaders = new Headers(fetchOptions.headers);
        // 逐地址覆盖凭据（公网网关 Basic / API key 门）：命中该地址已存凭据
        // 时整体替换 Authorization（插件 headers_with_auth 同语义）。凭据
        // 只进请求头——不写日志、不回传浏览器。
        const perAddressAuth = backendAuthHeader('controller', target).Authorization;
        if (perAddressAuth) upstreamHeaders.set('authorization', perAddressAuth);
        const incoming = /^W\/"([a-f0-9]{32})\.([A-Za-z0-9_-]+)"$/.exec(request.headers.get('If-None-Match') ?? '');
        if (conditionalRead && incoming?.[1] === validatorScope) {
          upstreamHeaders.set('If-None-Match', Buffer.from(incoming[2], 'base64url').toString());
        }
        const res = await fetch(targetUrl, { ...fetchOptions, headers: upstreamHeaders, signal: controller.signal });
        clearTimeout(timeout);
        if (res.status < 400) markWorking('controller', target);
        // Governance audit: record proxied mutations (success=info, upstream
        // 4xx/5xx=warning) with the server-resolved identity.
        auditProxiedMutation(request, path, method, res.status);

        const upstreamETag = conditionalRead ? res.headers.get('ETag') : null;
        const responseETag = upstreamETag
          ? `W/"${validatorScope}.${Buffer.from(upstreamETag).toString('base64url')}"` : null;
        if (res.status === 304) {
          if (!conditionalRead || !upstreamHeaders.has('If-None-Match')) {
            return NextResponse.json({ error: 'Controller returned 304 without a matching validator' }, { status: 502 });
          }
          return new NextResponse(null, {
            status: 304,
            headers: {
              ...(responseETag ? { ETag: responseETag } : {}),
              'Cache-Control': 'private, no-store',
              Vary: 'Authorization, Cookie',
            },
          });
        }

        // For 204 No Content
        if (res.status === 204) {
          return new NextResponse(null, { status: 204 });
        }

        if (options.stream && res.body) {
          // Stream the binary body through without buffering (D15).
          const responseHeaders = new Headers();
          const resCT = res.headers.get('content-type');
          if (resCT) responseHeaders.set('content-type', resCT);
          for (const name of options.passthroughHeaders ?? []) {
            const value = res.headers.get(name);
            if (value) responseHeaders.set(name, value);
          }
          responseHeaders.set('cache-control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          return new NextResponse(res.body, {
            status: res.status,
            headers: responseHeaders,
          });
        }

        const data = await res.arrayBuffer();
        // HTML-fallback guard: a stale/misrouted gateway (or a console SPA
        // catch-all, e.g. QwenPaw Console for a nonexistent worker) can answer
        // an API path with an HTML page while still claiming JSON — surfacing
        // that raw body would blow up every client res.json() with
        // "Unexpected token '<'". Rewrite it into an actionable 502 instead.
        const head = new Uint8Array(data.slice(0, 512));
        const headText = new TextDecoder('utf-8', { fatal: false })
          .decode(head)
          .trimStart()
          .slice(0, 64)
          .toLowerCase();
        if (headText.startsWith('<!doctype html') || headText.startsWith('<html')) {
          console.error(
            `[dashboard] upstream returned HTML for API path (gateway fallback?)`,
            JSON.stringify({ path, method, upstream_status: res.status }),
          );
          return NextResponse.json(
            {
              message:
                '上游返回了 HTML 页面而非 API 数据（常见原因：目标 Worker 不存在，请求被网关兜底到了控制台页面，或上游登录态失效）',
              upstream_status: res.status,
            },
            { status: 502 },
          );
        }
        const responseHeaders = new Headers();
        const resCT = res.headers.get('content-type');
        if (resCT) responseHeaders.set('content-type', resCT);
        if (responseETag && res.ok) {
          responseHeaders.set('ETag', responseETag);
          responseHeaders.set('Vary', 'Authorization, Cookie');
        }
        // Pass through any explicitly requested headers (e.g. content-disposition
        // for artifact downloads so RFC 5987 filenames survive the proxy).
        for (const name of options.passthroughHeaders ?? []) {
          const value = res.headers.get(name);
          if (value) responseHeaders.set(name, value);
        }
        // API responses should never be cached by the browser; stale cached
        // JSON causes the dashboard to show outdated or empty data.
        responseHeaders.set('cache-control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        responseHeaders.set('pragma', 'no-cache');
        responseHeaders.set('expires', '0');

        return new NextResponse(data, {
          status: res.status,
          headers: responseHeaders,
        });
      } catch (err: unknown) {
        clearTimeout(timeout);
        if (attempt < SAME_ADDRESS_RETRIES) {
          // Same-address retry first (plugin catch-all): a one-off blip on
          // this address should not force a switch to the other network.
          await new Promise((resolve) => setTimeout(resolve, SAME_ADDRESS_RETRY_MS));
          continue;
        }
        failures.push({
          url: target,
          error:
            err instanceof Error && err.name === 'AbortError'
              ? `timeout after ${TIMEOUT_MS}ms`
              : err instanceof Error
                ? err.message
                : 'unknown error',
        });
        break;
      }
    }
  }

  console.error(
    `[dashboard] controller failover exhausted (${targets.length} address(es))`,
    JSON.stringify(failures),
  );
  return NextResponse.json(
    {
      error: `后端地址全部不可达 (all ${targets.length} backend address(es) unreachable)`,
      details: failures,
    },
    { status: 502 },
  );
}
