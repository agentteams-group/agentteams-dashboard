// Shared helpers for Higress API route handlers
import { NextRequest } from 'next/server';
import { hasHigressSessionCookie } from '@/lib/api-auth';
import { getSessionFromRequest } from '@/lib/dashboard-session';

/**
 * Cookie header forwarded to the Higress Console for this request.
 *
 * 12.16: browser cookie wins when it carries a Higress session (Console-track
 * admin login forwards `_hi_sess` to the browser). Otherwise fall back to the
 * SERVER-BOUND Console session captured at login (L1 + admin verification) —
 * that cookie is never sent to the browser; the proxies are the only consumer.
 * Without the fallback the forwarded request reached the Console cookie-less
 * and answered "AuthException: Login required".
 */
export function getSessionCookie(request: NextRequest): string | null {
  const browser = request.headers.get('cookie');
  if (browser && hasHigressSessionCookie(browser)) {
    return browser;
  }
  const session = getSessionFromRequest(request);
  if (session?.consoleCookie) {
    return session.consoleCookie;
  }
  return browser;
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
  return { ...rest, tokenCount: typeof source.tokenCount === 'number' ? source.tokenCount : tokens.length };
}
