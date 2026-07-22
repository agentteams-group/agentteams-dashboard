// Shared proxy helper for AgentTeams API routes
import { NextRequest, NextResponse } from 'next/server';

const TIMEOUT_MS = 10000;

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
    const fs = await import('fs');
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
  // Default to the in-cluster service name so a missing env var does not
  // cause the dashboard to proxy to itself on localhost.
  return (
    process.env.AGENTTEAMS_CONTROLLER_URL ||
    process.env.AGENTTEAMS_API_URL ||
    'http://agentteams-controller:8090'
  );
}

export function getControllerUrl(request: NextRequest): string {
  const defaultUrl = getDefaultControllerUrl();
  const url = request.nextUrl.searchParams.get('controllerUrl');
  if (url) {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('Invalid protocol');
      }
      if (
        !ALLOWED_HOSTS.includes(parsed.hostname) &&
        !parsed.hostname.endsWith('.svc') &&
        !parsed.hostname.endsWith('.svc.cluster.local') &&
        !parsed.hostname.endsWith('.cluster.local') &&
        !parsed.hostname.endsWith('.local')
      ) {
        throw new Error('Host not allowed');
      }
    } catch {
      // If validation fails, fall back to default
      return defaultUrl;
    }
    return url;
  }
  return defaultUrl;
}

export async function proxyToAgentTeams(
  request: NextRequest,
  controllerUrl: string,
  path: string,
  options: {
    method?: string;
    forwardBody?: boolean;
    contentType?: string;
  } = {}
): Promise<NextResponse> {
  const { method = request.method, forwardBody = true, contentType } = options;
  const targetUrl = new URL(path, controllerUrl).toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const fetchOptions: RequestInit = {
      method,
      signal: controller.signal,
      headers: {},
    };

    // In cluster mode the dashboard must authenticate to the controller using its
    // own service-account token. When SA token is configured, NEVER trust the
    // browser-supplied Authorization header to prevent token injection attacks.
    // Only fall back to the incoming header when no server-side token exists at all.
    const saToken = await getAuthToken();
    const authToken = saToken || (
      request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || undefined
    );
    if (authToken) {
      (fetchOptions.headers as Record<string, string>)['authorization'] = `Bearer ${authToken}`;
    }

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

    const res = await fetch(targetUrl, fetchOptions);
    clearTimeout(timeout);

    // For 204 No Content
    if (res.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const data = await res.arrayBuffer();
    const responseHeaders = new Headers();
    const resCT = res.headers.get('content-type');
    if (resCT) responseHeaders.set('content-type', resCT);
    // API responses should never be cached by the browser; stale cached JSON
    // causes the dashboard to show outdated or empty data after restarts.
    responseHeaders.set('cache-control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    responseHeaders.set('pragma', 'no-cache');
    responseHeaders.set('expires', '0');

    return new NextResponse(data, {
      status: res.status,
      headers: responseHeaders,
    });
  } catch (err: unknown) {
    clearTimeout(timeout);
    const message = err instanceof Error && err.name === 'AbortError'
      ? 'Request timeout'
      : err instanceof Error
        ? err.message
        : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
