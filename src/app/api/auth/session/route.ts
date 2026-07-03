// GET /api/auth/session - Validate the browser's session via Higress Console
import { NextRequest, NextResponse } from 'next/server';
import { callHigressConsole, getHigressConsoleURL } from '../../higress/proxy-helper';

export async function GET(request: NextRequest) {
  try {
    const cookie = request.headers.get('cookie');
    if (!cookie) {
      return NextResponse.json({ authenticated: false }, { status: 200 });
    }

    return await validateViaHigress(request, cookie);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ authenticated: false, error: message }, { status: 200 });
  }
}

/** Validate session by probing Higress Console (original behaviour). */
async function validateViaHigress(request: NextRequest, cookie: string) {
  const consoleUrl = getHigressConsoleURL(request);

  const { response, body } = await callHigressConsole('/v1/consumers', {
    method: 'GET',
    cookie,
    consoleUrl,
  });

  if (!response.ok) {
    return NextResponse.json({ authenticated: false }, { status: 200 });
  }

  // Try to extract a display name/username from the profile if available.
  let username: string | undefined;
  if (typeof body === 'object' && body !== null && 'data' in body) {
    const data = (body as { data?: unknown }).data;
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
      const first = data[0] as { name?: string };
      username = first.name;
    }
  }

  return NextResponse.json({ authenticated: true, username, mode: 'higress' }, { status: 200 });
}

