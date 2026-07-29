// GET/POST /api/higress/ai-proxies — List / Create AI Providers via Higress Console
import { NextRequest, NextResponse } from 'next/server';
import { callHigressConsole, higressErrorResponse, higressProxyErrorResponse } from '../proxy-helper';
import { requireHigressConsoleAccess } from '../access';
import { validateProviderPayload } from '@/lib/higress-api';

function getSessionCookie(request: NextRequest): string | null {
  return request.headers.get('cookie');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unwrapData(body: unknown): unknown {
  return isRecord(body) && 'data' in body ? body.data : body;
}

function getProviders(body: unknown): Array<Record<string, unknown>> {
  const data = unwrapData(body);
  if (Array.isArray(data)) return data.filter(isRecord);
  if (isRecord(data) && Array.isArray(data.providers)) return data.providers.filter(isRecord);
  return [];
}

function maskProvider(provider: unknown) {
  const source = isRecord(provider) ? provider : {};
  const tokens = Array.isArray(source.tokens) ? source.tokens : [];
  const { tokens: _, ...rest } = source;
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

    // Mask API keys: only expose count, not actual tokens
    const masked = getProviders(body).map(maskProvider);

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

    // Higress Console returns the created provider in its standard { data } envelope.
    // Some deployed versions return an empty body, so retain the validated request shape.
    return NextResponse.json(maskProvider(unwrapData(resBody) ?? body), { status: 201 });
  } catch (err: unknown) {
    return higressProxyErrorResponse(err, 'Failed to create provider');
  }
}
