// Shared proxy helper for Higress Console API routes
import { NextResponse } from 'next/server';
import { addressUrl, readConfigSync } from '@/lib/backend-config';

const TIMEOUT_MS = 15000;
const FALLBACK_CONFIG_WRITE_ENABLED = process.env.AGENTTEAMS_HIGRESS_FALLBACK_CONFIG_WRITE_ENABLED === 'true';

// Embedded deployments retain these local Console hosts when no explicit allowlist exists.
const DEFAULT_ALLOWED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'agentteams-controller',
  'higress-console',
  'higress-console.higress-system',
  'higress-console.higress-system.svc',
  'higress-console.higress-system.svc.cluster.local',
];

export class HigressConsoleConfigurationError extends Error {
  constructor(reason: string) {
    super(`Higress Console deployment configuration error: ${reason}`);
    this.name = 'HigressConsoleConfigurationError';
  }
}

function isExternalAdapterMode(): boolean {
  return process.env.AGENTTEAMS_HIGRESS_ADAPTER_MODE === 'external';
}

function getAllowedHosts(): string[] {
  const configuredHosts = process.env.AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS;
  if (configuredHosts) {
    const hosts = configuredHosts
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    if (hosts.length > 0) {
      return hosts;
    }
  }

  if (isExternalAdapterMode()) {
    throw new HigressConsoleConfigurationError('AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS must list the Console host');
  }

  return DEFAULT_ALLOWED_HOSTS;
}

export function validateHigressConsoleURL(
  url: string,
  opts?: { trustedHosts?: string[] },
): string {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new HigressConsoleConfigurationError('Console URL must use HTTP or HTTPS');
    }
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    // trustedHosts: hosts saved through the token-gated setup page —
    // operator data for this deployment, authorized without an env
    // allowlist entry (post-merge review Block 2). Checked BEFORE the env
    // allowlist: in external mode without
    // AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS, getAllowedHosts() throws,
    // and a saved host must not be caught by that throw.
    if (opts?.trustedHosts?.includes(hostname)) {
      return parsed.toString();
    }
    const allowed = getAllowedHosts();
    if (!allowed.includes(hostname)) {
      throw new HigressConsoleConfigurationError(`Console host "${hostname}" is not allowed`);
    }
    return parsed.toString();
  } catch (error) {
    if (error instanceof HigressConsoleConfigurationError) {
      throw error;
    }
    throw new HigressConsoleConfigurationError('AGENTTEAMS_AI_GATEWAY_ADMIN_URL must be a valid URL');
  }
}

export function getHigressConsoleURL(): string {
  // Resolution order (post-merge review Block 2): saved config (setup page)
  // > env > embedded default. The Console track previously ignored the
  // saved `higress-console` address, so a standalone deployment always hit
  // the in-cluster URL. A host saved through the token-gated setup path is
  // operator data for this deployment: validated for shape, trusted for
  // host (the env allowlist still governs env-configured and embedded
  // URLs).
  const saved = readConfigSync()?.backends['higress-console'];
  // 地址条目可能是纯字符串或 {url, auth}（逐地址凭据）——统一经 addressUrl
  // 取 URL；higress 这一轮不加覆盖凭据头（仅 controller/matrix）。
  const savedUrl = addressUrl(saved?.internal) || addressUrl(saved?.external);
  if (savedUrl) {
    const savedHost = new URL(savedUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return validateHigressConsoleURL(savedUrl, { trustedHosts: [savedHost] });
  }
  const configuredUrl = process.env.AGENTTEAMS_AI_GATEWAY_ADMIN_URL;
  if (!configuredUrl) {
    if (isExternalAdapterMode()) {
      throw new HigressConsoleConfigurationError('AGENTTEAMS_AI_GATEWAY_ADMIN_URL must be configured');
    }
    return validateHigressConsoleURL('http://agentteams-controller:8001');
  }
  return validateHigressConsoleURL(configuredUrl);
}

export function isFallbackConfigWriteEnabled(): boolean {
  return FALLBACK_CONFIG_WRITE_ENABLED;
}

export function prepareAiRoutePayload(body: Record<string, unknown>): Record<string, unknown> {
  if (isFallbackConfigWriteEnabled()) return body;
  const { fallbackConfig: _, ...payload } = body;
  return payload;
}

/** 12.16: Set-Cookie 头列表 → 可直接用于下一请求的 Cookie 值串（name=value）。
 *  用于把管理员验证得到的 Console 会话「服务端绑定」进 dashboard 会话
 *  （不转发给浏览器——见 access.ts 的绑定校验）。 */
export function collectSetCookieHeader(sourceHeaders: Headers): string | undefined {
  const parts = sourceHeaders
    .getSetCookie()
    .map((c) => c.split(';')[0]?.trim())
    .filter((c): c is string => Boolean(c && c.includes('=')));
  return parts.length > 0 ? parts.join('; ') : undefined;
}

export function forwardCookies(sourceHeaders: Headers, targetHeaders: Headers): void {
  const setCookie = sourceHeaders.getSetCookie();
  for (const cookie of setCookie) {
    targetHeaders.append('Set-Cookie', cookie);
  }
}

export async function callHigressConsole(
  path: string,
  options: {
    method?: string;
    body?: string | Record<string, unknown>;
    cookie?: string | null;
  } = {}
): Promise<{ response: Response; body: unknown }> {
  // Single resolution path (post-merge review Block 2 follow-up): every
  // caller goes through getHigressConsoleURL(). The previous optional
  // consoleUrl accepted raw caller values (e.g. the env var read directly in
  // api-auth) and self-signed their own host into trustedHosts — bypassing
  // the allowlist (the Higress session cookie could be forwarded to an
  // unauthorised host) while desyncing session validation from the login
  // URL. Callers that need the URL for logging resolve it themselves via
  // getHigressConsoleURL().
  const consoleUrl = getHigressConsoleURL();
  const targetUrl = new URL(path, consoleUrl).toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const fetchOptions: RequestInit = {
      method: options.method || 'GET',
      signal: controller.signal,
      headers: {},
    };

    const headers = fetchOptions.headers as Record<string, string>;
    headers['Accept'] = 'application/json';
    if (options.cookie) {
      headers['Cookie'] = options.cookie;
    }

    if (options.body) {
      headers['Content-Type'] = 'application/json';
      fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    const response = await fetch(targetUrl, fetchOptions);
    clearTimeout(timeout);

    let body: unknown;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      body = await response.json().catch(() => null);
    } else {
      body = await response.text().catch(() => null);
    }

    return { response, body };
  } catch (err: unknown) {
    clearTimeout(timeout);
    const message =
      err instanceof Error && err.name === 'AbortError'
        ? 'Request timeout'
        : err instanceof Error
          ? err.message
          : 'Unknown error';
    throw new Error(message);
  }
}

export function higressErrorResponse(response: Response, body: unknown): NextResponse {
  const message =
    typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string'
      ? body.message
      : typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : typeof body === 'string' && body
          ? body
          : `Higress Console returned HTTP ${response.status}`;
  return NextResponse.json({ success: false, error: message }, { status: response.status });
}

export function higressProxyErrorResponse(error: unknown, fallbackMessage: string): NextResponse {
  const message = error instanceof Error ? error.message : fallbackMessage;
  const status = error instanceof HigressConsoleConfigurationError ? 503 : 502;
  return NextResponse.json({ success: false, error: message }, { status });
}
