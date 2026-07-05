// GET/POST /api/higress/ai-proxies — List / Create AI Providers via Higress Console
import { NextRequest, NextResponse } from 'next/server';
import { callHigressConsole, higressErrorResponse } from '../proxy-helper';

function getSessionCookie(request: NextRequest): string | null {
  return request.headers.get('cookie');
}

// GET — List all LLM providers
export async function GET(request: NextRequest) {
  try {
    const cookie = getSessionCookie(request);
    const { response, body } = await callHigressConsole('/v1/ai/providers', {
      method: 'GET',
      cookie,
    });

    if (!response.ok) {
      return higressErrorResponse(response, body);
    }

    // Higress returns { providers: [...] } or a direct array
    const providers = Array.isArray(body) ? body : (body as Record<string, unknown>)?.providers ?? [];

    // Mask API keys: only expose count, not actual tokens
    const masked = (providers as Array<Record<string, unknown>>).map((p) => {
      const tokens = p.tokens as string[] | undefined;
      const { tokens: _, ...rest } = p;
      return {
        ...rest,
        tokenCount: tokens?.length ?? 0,
      };
    });

    return NextResponse.json({ providers: masked });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to list providers';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

// POST — Create a new LLM provider
export async function POST(request: NextRequest) {
  try {
    const cookie = getSessionCookie(request);
    const body = await request.json();

    if (!body.name || !body.type) {
      return NextResponse.json({ error: 'name and type are required' }, { status: 400 });
    }

    const { response, body: resBody } = await callHigressConsole('/v1/ai/providers', {
      method: 'POST',
      body,
      cookie,
    });

    if (!response.ok) {
      return higressErrorResponse(response, resBody);
    }

    return NextResponse.json(resBody, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create provider';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
