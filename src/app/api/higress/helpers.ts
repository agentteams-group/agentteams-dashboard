// Shared helpers for Higress API route handlers
import { NextRequest } from 'next/server';

export function getSessionCookie(request: NextRequest): string | null {
  return request.headers.get('cookie');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function unwrapData(body: unknown): unknown {
  return isRecord(body) && 'data' in body ? body.data : body;
}

export function maskProvider(provider: unknown) {
  const source = isRecord(provider) ? provider : {};
  const tokens = Array.isArray(source.tokens) ? source.tokens : [];
  const { tokens: _, ...rest } = source;
  return { ...rest, tokenCount: tokens.length };
}
