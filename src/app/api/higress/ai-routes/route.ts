// GET/POST /api/higress/ai-routes — List / Create AI Routes via Higress Console
import { NextRequest, NextResponse } from 'next/server';
import { callHigressConsole, higressErrorResponse } from '../proxy-helper';

function getSessionCookie(request: NextRequest): string | null {
  return request.headers.get('cookie');
}

// GET — List all AI routes
export async function GET(request: NextRequest) {
  try {
    const cookie = getSessionCookie(request);
    const { response, body } = await callHigressConsole('/v1/ai/routes', {
      method: 'GET',
      cookie,
    });

    if (!response.ok) {
      return higressErrorResponse(response, body);
    }

    const routes = Array.isArray(body) ? body : (body as Record<string, unknown>)?.routes ?? [];
    return NextResponse.json({ routes });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to list routes';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

// POST — Create a new AI route
export async function POST(request: NextRequest) {
  try {
    const cookie = getSessionCookie(request);
    const body = await request.json();

    if (!body.name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const { response, body: resBody } = await callHigressConsole('/v1/ai/routes', {
      method: 'POST',
      body,
      cookie,
    });

    if (!response.ok) {
      return higressErrorResponse(response, resBody);
    }

    return NextResponse.json(resBody, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create route';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
