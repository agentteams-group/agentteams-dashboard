// POST /api/auth/login - Authenticate via Higress Console
// Also attempts Matrix login with the same credentials for seamless chat access.
import { NextRequest, NextResponse } from 'next/server';
import { callHigressConsole, forwardCookies, getHigressConsoleURL, higressErrorResponse } from '../../higress/proxy-helper';
import { validateHomeserverUrl } from '@/lib/homeserver-allowlist';

const MATRIX_HOMESERVER =
  process.env.NEXT_PUBLIC_MATRIX_API_URL ||
  process.env.HICLAW_MATRIX_URL ||
  'http://hiclaw-tuwunel.hiclaw-system:6167';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json({ success: false, error: 'Username and password are required' }, { status: 400 });
    }

    return await loginViaHigress(request, username, password);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}

/**
 * Attempt Matrix login with the same credentials.
 * Returns the Matrix login result or null if it fails.
 */
async function tryMatrixLogin(username: string, password: string): Promise<Record<string, unknown> | null> {
  try {
    validateHomeserverUrl(MATRIX_HOMESERVER, { allowPrivateNetwork: true });
  } catch {
    return null; // Invalid homeserver URL, skip
  }

  try {
    const res = await fetch(`${MATRIX_HOMESERVER}/_matrix/client/v3/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: username },
        password,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;

    const data = await res.json();
    return {
      accessToken: data.access_token,
      userId: data.user_id,
      deviceId: data.device_id,
      homeserver: MATRIX_HOMESERVER,
    };
  } catch {
    return null; // Matrix unreachable or login failed, skip silently
  }
}

/** Authenticate against Higress Console (original behaviour). */
async function loginViaHigress(request: NextRequest, username: string, password: string) {
  const consoleUrl = getHigressConsoleURL(request);

  // 1. Initialize Higress Console admin account (idempotent).
  try {
    await callHigressConsole('/system/init', {
      method: 'POST',
      body: {
        adminUser: {
          name: username,
          password,
          displayName: username,
        },
      },
      consoleUrl,
    });
  } catch {
    // continue to login attempt
  }

  // 2. Login to obtain the session cookie.
  const { response, body: loginBody } = await callHigressConsole('/session/login', {
    method: 'POST',
    body: { username, password },
    consoleUrl,
  });

  if (!response.ok) {
    return higressErrorResponse(response, loginBody);
  }

  // 3. Attempt Matrix login with the same credentials (non-blocking).
  const matrix = await tryMatrixLogin(username, password);

  // Forward Set-Cookie headers from Higress Console back to the browser.
  const responseHeaders = new Headers();
  responseHeaders.set('content-type', 'application/json');
  responseHeaders.set('cache-control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  forwardCookies(response.headers, responseHeaders);

  return new NextResponse(
    JSON.stringify({ success: true, user: { username }, mode: 'higress', matrix }),
    { status: 200, headers: responseHeaders }
  );
}

