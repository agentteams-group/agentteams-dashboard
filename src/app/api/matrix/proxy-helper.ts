// Shared proxy helper for Matrix Client-Server API routes
import { NextRequest, NextResponse } from 'next/server';
import {
  HomeserverValidationError,
  validateHomeserverUrl,
} from '@/lib/homeserver-allowlist';
import { backendAuthHeader } from '@/lib/backend-config';

const TIMEOUT_MS = 30000; // Matrix sync can take longer

export function getMatrixHomeserver(request: NextRequest): string {
  const url = request.nextUrl.searchParams.get('homeserver');
  if (!url) {
    throw new Error('Missing homeserver URL. Provide via ?homeserver= parameter.');
  }
  try {
    // SEC-05：这些路由会把用户的 Authorization Bearer token 转发给
    // homeserver——必须强制允许列表（内置默认列表覆盖嵌入部署的
    // localhost / agentteams-controller / matrix-local.agentteams.io），
    // 避免 token 中继到运维未批准的任意公网主机。
    validateHomeserverUrl(url, { requireAllowlist: true });
  } catch (err) {
    if (err instanceof HomeserverValidationError) {
      throw err;
    }
    throw new Error('Invalid homeserver URL format');
  }
  return url;
}

export function getAccessToken(request: NextRequest): string {
  // Authorization header only — never accept tokens via query string, which
  // would leak into access logs, browser history, and referer headers.
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) {
    throw new Error('Missing access token. Provide via Authorization header.');
  }
  return token;
}

export async function proxyToMatrix(
  request: NextRequest,
  homeserver: string,
  path: string,
  accessToken: string,
  options: {
    method?: string;
    forwardBody?: boolean;
    timeout?: number;
  } = {}
): Promise<NextResponse> {
  const { method = request.method, forwardBody = true, timeout = TIMEOUT_MS } = options;
  const targetUrl = `${homeserver}${path}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    // 逐地址覆盖凭据（公网网关 Basic / API key 门）：命中该地址已存凭据时
    // 整体替换 Authorization（插件 headers_with_auth 语义）。凭据只进请求头。
    const perAddressAuth = backendAuthHeader('matrix', homeserver).Authorization;
    const fetchOptions: RequestInit = {
      method,
      signal: controller.signal,
      headers: {
        'Authorization': perAddressAuth ?? `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      } as Record<string, string>,
    };

    if (forwardBody && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = await request.text();
    }

    const res = await fetch(targetUrl, fetchOptions);
    clearTimeout(timeoutId);

    if (res.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const data = await res.arrayBuffer();
    const responseHeaders = new Headers();
    const resCT = res.headers.get('content-type');
    if (resCT) responseHeaders.set('content-type', resCT);

    return new NextResponse(data, {
      status: res.status,
      headers: responseHeaders,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const message = err instanceof Error && err.name === 'AbortError'
      ? 'Matrix request timeout'
      : err instanceof Error
        ? err.message
        : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
