// Shared API authentication helpers for /api/agentteams/* routes.
// Validates the browser's Higress Console session cookie before allowing
// write operations to reach the controller.
import { NextRequest } from 'next/server';
import { callHigressConsole } from '../app/api/higress/proxy-helper';

// In-memory session validation cache (30s TTL) to avoid hitting Higress
// Console on every API request. Keyed by a hash of the Higress session cookie.
const sessionCache = new Map<string, CachedSession>();
const CACHE_TTL_MS = 30_000;
const MAX_CACHE_SIZE = 1000;

interface CachedSession {
  valid: boolean;
  user: SessionUser | null;
  expires: number;
}

export interface SessionUser {
  name: string;
  level: number;
}

function extractSessionCookie(cookie: string): string {
  // Extract only Higress-relevant cookies to keep the cache key stable
  // and avoid pollution from unrelated cookies (GA, ads, etc.).
  return cookie
    .split(';')
    .map((c) => c.trim())
    .filter((c) => {
      const name = c.split('=')[0];
      // Higress Console uses `_hi_sess` (and historically `_higress*`/`higress*`);
      // also accept generic session / connect.sid for local dev fallback stores.
      return /^(_?hi(gress)?|session|connect\.sid)/i.test(name);
    })
    .join(';');
}

function hashCookie(cookie: string): string {
  // Simple but effective hash (djb2) — good enough for cache key uniqueness.
  let h = 5381;
  for (let i = 0; i < cookie.length; i++) {
    h = ((h << 5) + h + cookie.charCodeAt(i)) | 0;
  }
  return 'c' + (h >>> 0).toString(36);
}

function pruneCache() {
  if (sessionCache.size <= MAX_CACHE_SIZE) return;
  const now = Date.now();
  // Delete expired entries first
  for (const [k, v] of sessionCache) {
    if (v.expires < now) sessionCache.delete(k);
  }
  // If still over limit, evict oldest entries
  if (sessionCache.size > MAX_CACHE_SIZE) {
    const entries = [...sessionCache.entries()].sort((a, b) => a[1].expires - b[1].expires);
    const toDelete = entries.slice(0, entries.length - MAX_CACHE_SIZE);
    for (const [k] of toDelete) sessionCache.delete(k);
  }
}

function extractUser(body: unknown): SessionUser | null {
  if (!body || typeof body !== 'object') return null;
  // Higress `/v1/consumers` may return either the consumer object directly
  // (`{ name, ... }`) or a list (`[{ name, ... }]`). Accept both shapes.
  const candidates: unknown[] = Array.isArray(body) ? body : [body];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Record<string, unknown>;
    const name = record.name ?? record.username ?? record.userName;
    if (typeof name !== 'string' || name.length === 0) continue;
    const levelRaw = record.level ?? record.permissionLevel ?? record.accessLevel ?? 1;
    const level = typeof levelRaw === 'number' ? levelRaw : Number(levelRaw);
    return { name, level: Number.isFinite(level) ? level : 1 };
  }
  return null;
}

export interface SessionValidation {
  valid: boolean;
  user: SessionUser | null;
}

/**
 * Validate the browser's Higress Console session by forwarding the cookie
 * to the Higress Console /v1/consumers endpoint. Results are cached for 30s.
 * Returns `{ valid, user }` — `user` is populated whenever the response body
 * carries a recognisable consumer record.
 *
 * Ignores user-supplied ?consoleUrl= parameter and always uses the configured
 * environment URL to prevent SSRF via cookie forwarding.
 */
export async function validateHigressSession(request: NextRequest): Promise<SessionValidation> {
  const empty: SessionValidation = { valid: false, user: null };
  const cookie = request.headers.get('cookie');
  if (!cookie) {
    return empty;
  }

  const sessionPart = extractSessionCookie(cookie);
  if (!sessionPart) {
    return empty;
  }

  // Check cache first
  const key = hashCookie(sessionPart);
  const cached = sessionCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return { valid: cached.valid, user: cached.user };
  }

  try {
    // Always use the configured server-side Console URL, never accept
    // user-supplied consoleUrl query param for auth validation (SSRF protection).
    const consoleUrl = process.env.AGENTTEAMS_AI_GATEWAY_ADMIN_URL || undefined;
    const { response, body } = await callHigressConsole('/v1/consumers', {
      method: 'GET',
      cookie,
      consoleUrl,
    });

    const valid = response.ok;
    const user = valid ? extractUser(body) : null;

    // Cache the result. Invalid sessions get shorter TTL to reduce cache poisoning risk.
    sessionCache.set(key, {
      valid,
      user,
      expires: Date.now() + (valid ? CACHE_TTL_MS : 5000),
    });
    pruneCache();

    return { valid, user };
  } catch {
    return empty;
  }
}


