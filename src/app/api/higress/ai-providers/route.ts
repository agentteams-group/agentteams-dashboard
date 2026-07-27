// GET/POST /api/higress/ai-proxies — List / Create AI Providers via Higress Console
import { NextRequest, NextResponse } from 'next/server';
import { callHigressConsole, higressErrorResponse, higressProxyErrorResponse } from '../proxy-helper';
import { requireHigressConsoleAccess } from '../access';
import { validateProviderPayload } from '@/lib/higress-api';

function getSessionCookie(request: NextRequest): string | null {
  return request.headers.get('cookie');
}

function maskProvider(provider: Record<string, unknown>) {
  const tokens = Array.isArray(provider.tokens) ? provider.tokens : [];
  const { tokens: _, ...rest } = provider;
  return { ...rest, tokenCount: tokens.length };
}

// GET — List all LLM providers
export async function GET(request: NextRequest) {
  try {
    const rejected = await requireHigressConsoleAccess(request);
    if (rejected) return rejected;
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
    const masked = (providers as Array<Record<string, unknown>>).map(maskProvider);

    return NextResponse.json({ providers: masked });
  } catch (err: unknown) {
    return higressProxyErrorResponse(err, 'Failed to list providers');
  }
}

// POST — Create a new LLM provider
export async function POST(request: NextRequest) {
  try {
    const rejected = await requireHigressConsoleAccess(request);
    if (rejected) return rejected;
    const cookie = getSessionCookie(request);
    const body: unknown = await request.json().catch(() => null);
    const validationErrors = validateProviderPayload(body);
    if (validationErrors.length > 0) return NextResponse.json({ success: false, error: validationErrors[0] }, { status: 400 });

    const { response, body: resBody } = await callHigressConsole('/v1/ai/providers', {
      method: 'POST',
      body: body as Record<string, unknown>,
      cookie,
    });

    if (!response.ok) {
      return higressErrorResponse(response, resBody);
    }

    return NextResponse.json(maskProvider(resBody as Record<string, unknown>), { status: 201 });
  } catch (err: unknown) {
    return higressProxyErrorResponse(err, 'Failed to create provider');
  }
}
