// GET/PUT/DELETE /api/higress/ai-routes/[name] — Single AI Route operations
import { NextRequest, NextResponse } from 'next/server';
import { callHigressConsole, higressErrorResponse, higressProxyErrorResponse, isFallbackConfigWriteEnabled, prepareAiRoutePayload } from '../../proxy-helper';
import { requireHigressConsoleAccess } from '../../access';
import { validateAiRoutePayload } from '@/lib/higress-api';

function getSessionCookie(request: NextRequest): string | null {
  return request.headers.get('cookie');
}

// GET — Get a single AI route
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  try {
    const rejected = await requireHigressConsoleAccess(request);
    if (rejected) return rejected;
    const cookie = getSessionCookie(request);
    const { response, body } = await callHigressConsole(
      `/v1/ai/routes/${encodeURIComponent(name)}`,
      { method: 'GET', cookie }
    );

    if (!response.ok) {
      return higressErrorResponse(response, body);
    }

    return NextResponse.json({ ...(body as Record<string, unknown>), fallbackConfigWritable: isFallbackConfigWriteEnabled() });
  } catch (err: unknown) {
    return higressProxyErrorResponse(err, 'Failed to get route');
  }
}

// PUT — Update an AI route
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  try {
    const rejected = await requireHigressConsoleAccess(request);
    if (rejected) return rejected;
    const cookie = getSessionCookie(request);
    const body: unknown = await request.json().catch(() => null);
    const validationErrors = validateAiRoutePayload(body, true);
    if (validationErrors.length > 0) return NextResponse.json({ success: false, error: validationErrors[0] }, { status: 400 });

    const { response, body: resBody } = await callHigressConsole(
      `/v1/ai/routes/${encodeURIComponent(name)}`,
      { method: 'PUT', body: prepareAiRoutePayload(body as Record<string, unknown>), cookie }
    );

    if (!response.ok) {
      return higressErrorResponse(response, resBody);
    }

    return NextResponse.json(resBody);
  } catch (err: unknown) {
    return higressProxyErrorResponse(err, 'Failed to update route');
  }
}

// DELETE — Delete an AI route
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  try {
    const rejected = await requireHigressConsoleAccess(request);
    if (rejected) return rejected;
    const cookie = getSessionCookie(request);
    const { response, body } = await callHigressConsole(
      `/v1/ai/routes/${encodeURIComponent(name)}`,
      { method: 'DELETE', cookie }
    );

    if (!response.ok) {
      return higressErrorResponse(response, body);
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return higressProxyErrorResponse(err, 'Failed to delete route');
  }
}
