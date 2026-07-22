// Shared API authentication helpers for /api/agentteams/* routes.
// Validates the browser's Higress Console session cookie before allowing
// write operations to reach the controller.
import { NextRequest } from 'next/server';
import { callHigressConsole } from '../app/api/higress/proxy-helper';

// In-memory session validation cache (30s TTL) to avoid hitting Higress
// Console on every API request. Keyed by a hash of the Higress session cookie.
const sessionCache = new Map<string, { valid: boolean; expires: number }>();
const CACHE_TTL_MS = 30_000;
const MAX_CACHE_SIZE = 1000;

function extractSessionCookie(cookie: string): string {
  // Extract only Higress-relevant cookies to keep the cache key stable
  // and avoid pollution from unrelated cookies (GA, ads, etc.).
  return cookie
    .split(';')
    .map((c) => c.trim())
    .filter((c) => {
      const name = c.split('=')[0];
      // Higress Console typically uses session cookies; match common patterns.
      return /^(_?higress|session|connect\.sid)/i.test(name);
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

/**
 * Validate the browser's Higress Console session by forwarding the cookie
 * to the Higress Console /v1/consumers endpoint. Results are cached for 30s.
 * Returns true if the session is valid, false otherwise.
 *
 * Ignores user-supplied ?consoleUrl= parameter and always uses the configured
 * environment URL to prevent SSRF via cookie forwarding.
 */
export async function validateHigressSession(request: NextRequest): Promise<boolean> {
  const cookie = request.headers.get('cookie');
  if (!cookie) {
    return false;
  }

  const sessionPart = extractSessionCookie(cookie);
  if (!sessionPart) {
    return false;
  }

  // Check cache first
  const key = hashCookie(sessionPart);
  const cached = sessionCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.valid;
  }

  try {
    // Always use the configured server-side Console URL, never accept
    // user-supplied consoleUrl query param for auth validation (SSRF protection).
    const consoleUrl = process.env.AGENTTEAMS_AI_GATEWAY_ADMIN_URL || undefined;
    const { response } = await callHigressConsole('/v1/consumers', {
      method: 'GET',
      cookie,
      consoleUrl,
    });

    const valid = response.ok;

    // Cache the result. Invalid sessions get shorter TTL to reduce cache poisoning risk.
    sessionCache.set(key, {
      valid,
      expires: Date.now() + (valid ? CACHE_TTL_MS : 5000),
    });
    pruneCache();

    return valid;
  } catch {
    return false;
  }
}

/**
 * Returns true if a usable server-side auth token is actually available,
 * verifying the file is readable (not just that the env var is set).
 */
export async function hasServerAuthToken(): Promise<boolean> {
  if (process.env.AGENTTEAMS_AUTH_TOKEN) {
    return true;
  }
  const tokenFile = process.env.AGENTTEAMS_AUTH_TOKEN_FILE;
  if (!tokenFile) {
    return false;
  }
  try {
    const fs = await import('fs');
    const token = fs.readFileSync(tokenFile, 'utf-8').trim();
    return token.length > 0;
  } catch {
    return false;
  }
}
