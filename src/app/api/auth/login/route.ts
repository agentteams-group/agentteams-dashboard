// POST /api/auth/login - Authenticate via Higress Console or local fallback
import { NextRequest, NextResponse } from 'next/server';
import { callHigressConsole, forwardCookies, getHigressConsoleURL, higressErrorResponse } from '../../higress/proxy-helper';
import { authenticateLocal, createSessionToken, isHigressConfigured } from '@/lib/auth-local';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json({ success: false, error: 'Username and password are required' }, { status: 400 });
    }

    // ── Path A: Higress Console is configured → proxy auth to Higress ──
    if (isHigressConfigured()) {
      return await loginViaHigress(request, username, password);
    }

    // ── Path B: No Higress → local auth fallback ──
    return await loginViaLocal(username, password);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 502 });
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

  // Forward Set-Cookie headers from Higress Console back to the browser.
  const responseHeaders = new Headers();
  responseHeaders.set('content-type', 'application/json');
  responseHeaders.set('cache-control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  forwardCookies(response.headers, responseHeaders);

  return new NextResponse(
    JSON.stringify({ success: true, user: { username }, mode: 'higress' }),
    { status: 200, headers: responseHeaders }
  );
}

/** Authenticate against the local user store (first login creates the admin). */
async function loginViaLocal(username: string, password: string) {
  const result = await authenticateLocal(username, password);

  if (!result.success) {
    return NextResponse.json(
      { success: false, error: result.error || 'Login failed' },
      { status: 401 }
    );
  }

  // Create a signed session cookie.
  const token = createSessionToken(username);
  const responseHeaders = new Headers();
  responseHeaders.set('content-type', 'application/json');
  responseHeaders.set('cache-control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  responseHeaders.append(
    'Set-Cookie',
    `hiclaw_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`
  );

  return new NextResponse(
    JSON.stringify({ success: true, user: { username }, mode: 'local' }),
    { status: 200, headers: responseHeaders }
  );
}
