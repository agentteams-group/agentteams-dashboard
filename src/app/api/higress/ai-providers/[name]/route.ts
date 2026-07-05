// GET/PUT/DELETE /api/higress/ai-providers/[name] — Single AI Provider operations
import { NextRequest, NextResponse } from 'next/server';
import { callHigressConsole, higressErrorResponse } from '../../proxy-helper';

function getSessionCookie(request: NextRequest): string | null {
  return request.headers.get('cookie');
}

// GET — Get a single provider
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  try {
    const cookie = getSessionCookie(request);
    const { response, body } = await callHigressConsole(
      `/v1/ai/providers/${encodeURIComponent(name)}`,
      { method: 'GET', cookie }
    );

    if (!response.ok) {
      return higressErrorResponse(response, body);
    }

    const provider = body as Record<string, unknown>;
    const tokens = provider.tokens as string[] | undefined;
    const { tokens: _, ...rest } = provider;
    return NextResponse.json({ ...rest, tokenCount: tokens?.length ?? 0 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to get provider';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

// PUT — Update a provider
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  try {
    const cookie = getSessionCookie(request);
    const body = await request.json();

    const { response, body: resBody } = await callHigressConsole(
      `/v1/ai/providers/${encodeURIComponent(name)}`,
      { method: 'PUT', body, cookie }
    );

    if (!response.ok) {
      return higressErrorResponse(response, resBody);
    }

    return NextResponse.json(resBody);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update provider';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

// DELETE — Delete a provider
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  try {
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
    const message = err instanceof Error ? err.message : 'Failed to delete provider';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
