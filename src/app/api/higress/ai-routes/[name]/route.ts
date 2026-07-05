// GET/PUT/DELETE /api/higress/ai-routes/[name] — Single AI Route operations
import { NextRequest, NextResponse } from 'next/server';
import { callHigressConsole, higressErrorResponse } from '../../proxy-helper';

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
    const cookie = getSessionCookie(request);
    const { response, body } = await callHigressConsole(
      `/v1/ai/routes/${encodeURIComponent(name)}`,
      { method: 'GET', cookie }
    );

    if (!response.ok) {
      return higressErrorResponse(response, body);
    }

    return NextResponse.json(body);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to get route';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

// PUT — Update an AI route
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  try {
    const cookie = getSessionCookie(request);
    const body = await request.json();

    const { response, body: resBody } = await callHigressConsole(
      `/v1/ai/routes/${encodeURIComponent(name)}`,
      { method: 'PUT', body, cookie }
    );

    if (!response.ok) {
      return higressErrorResponse(response, resBody);
    }

    return NextResponse.json(resBody);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update route';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

// DELETE — Delete an AI route
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  try {
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
    const message = err instanceof Error ? err.message : 'Failed to delete route';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
