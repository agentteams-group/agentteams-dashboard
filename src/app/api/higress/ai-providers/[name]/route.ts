// GET/PUT/DELETE /api/higress/ai-providers/[name] — Single AI Provider operations
import { NextRequest, NextResponse } from 'next/server';
import { callHigressConsole, higressErrorResponse, higressProxyErrorResponse } from '../../proxy-helper';
import { requireHigressConsoleAccess } from '../../access';
import { validateProviderPayload } from '@/lib/higress-api';

function getSessionCookie(request: NextRequest): string | null {
  return request.headers.get('cookie');
}

function maskProvider(provider: Record<string, unknown>) {
  const tokens = Array.isArray(provider.tokens) ? provider.tokens : [];
  const { tokens: _, ...rest } = provider;
  return { ...rest, tokenCount: tokens.length };
}

// GET — Get a single provider
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
      `/v1/ai/providers/${encodeURIComponent(name)}`,
      { method: 'GET', cookie }
    );

    if (!response.ok) {
      return higressErrorResponse(response, body);
    }

    const provider = body as Record<string, unknown>;
    return NextResponse.json(maskProvider(provider));
  } catch (err: unknown) {
    return higressProxyErrorResponse(err, 'Failed to get provider');
  }
}

// PUT — Update a provider
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
    const validationErrors = validateProviderPayload(body, true);
    if (validationErrors.length > 0) return NextResponse.json({ success: false, error: validationErrors[0] }, { status: 400 });

    const { response, body: resBody } = await callHigressConsole(
      `/v1/ai/providers/${encodeURIComponent(name)}`,
       { method: 'PUT', body: body as Record<string, unknown>, cookie }
    );

    if (!response.ok) {
      return higressErrorResponse(response, resBody);
    }

    return NextResponse.json(maskProvider(resBody as Record<string, unknown>));
  } catch (err: unknown) {
    return higressProxyErrorResponse(err, 'Failed to update provider');
  }
}

// DELETE — Delete a provider
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
      `/v1/ai/providers/${encodeURIComponent(name)}`,
      { method: 'DELETE', cookie }
    );

    if (!response.ok) {
      return higressErrorResponse(response, body);
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return higressProxyErrorResponse(err, 'Failed to delete provider');
  }
}
