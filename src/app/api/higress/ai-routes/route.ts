// GET/POST /api/higress/ai-routes — List / Create AI Routes via Higress Console
import { NextRequest, NextResponse } from 'next/server';
import { callHigressConsole, higressErrorResponse, higressProxyErrorResponse, isFallbackConfigWriteEnabled, prepareAiRoutePayload } from '../proxy-helper';
import { requireHigressConsoleAccess } from '../access';
import { validateAiRoutePayload } from '@/lib/higress-api';

function getSessionCookie(request: NextRequest): string | null {
  return request.headers.get('cookie');
}

// GET — List all AI routes
export async function GET(request: NextRequest) {
  try {
    const rejected = await requireHigressConsoleAccess(request);
    if (rejected) return rejected;
    const cookie = getSessionCookie(request);
    const { response, body } = await callHigressConsole('/v1/ai/routes', {
      method: 'GET',
      cookie,
    });

    if (!response.ok) {
      return higressErrorResponse(response, body);
    }

    const routes = Array.isArray(body) ? body : (body as Record<string, unknown>)?.routes ?? [];
    return NextResponse.json({ routes, fallbackConfigWritable: isFallbackConfigWriteEnabled() });
  } catch (err: unknown) {
    return higressProxyErrorResponse(err, 'Failed to list routes');
  }
}

// POST — Create a new AI route
export async function POST(request: NextRequest) {
  try {
    const rejected = await requireHigressConsoleAccess(request);
    if (rejected) return rejected;
    const cookie = getSessionCookie(request);
    const body: unknown = await request.json().catch(() => null);
    const validationErrors = validateAiRoutePayload(body);
    if (validationErrors.length > 0) return NextResponse.json({ success: false, error: validationErrors[0] }, { status: 400 });

    const { response, body: resBody } = await callHigressConsole('/v1/ai/routes', {
      method: 'POST',
      body: prepareAiRoutePayload(body as Record<string, unknown>),
      cookie,
    });

    if (!response.ok) {
      return higressErrorResponse(response, resBody);
    }

    return NextResponse.json(resBody, { status: 201 });
  } catch (err: unknown) {
    return higressProxyErrorResponse(err, 'Failed to create route');
  }
}
