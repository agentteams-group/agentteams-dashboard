// Shared proxy helper for Higress Console API routes
import { NextResponse } from 'next/server';

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

export function validateHigressConsoleURL(url: string): string {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new HigressConsoleConfigurationError('Console URL must use HTTP or HTTPS');
    }
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!getAllowedHosts().includes(hostname)) {
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
    consoleUrl?: string;
  } = {}
): Promise<{ response: Response; body: unknown }> {
  const consoleUrl = options.consoleUrl ? validateHigressConsoleURL(options.consoleUrl) : getHigressConsoleURL();
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
