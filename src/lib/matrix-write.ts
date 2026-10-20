/**
 * Authenticated client for Matrix proxy routes that write room state / send
 * messages.
 *
 * The generic `fetch` patch in `client-auth-fetch.ts` only authorizes the
 * dashboard API (`/api/agentteams/`, `/api/auth/`); `/api/matrix/*` proxies
 * require the homeserver (`?homeserver=`) and a Matrix access token
 * (`Authorization: Bearer`) on every call. This helper resolves both from the
 * Matrix store at call time so write clients stay one-liners and never fall
 * back to token-less requests (which the BFF rejects with 400).
 */

import { apiUrl } from './api-base';
import { useMatrixStore } from './matrix-store';

export interface MatrixAuth {
  homeserver: string;
  accessToken: string;
}

/** Snapshot of the current Matrix credentials (empty strings when logged out). */
export function currentMatrixAuth(): MatrixAuth {
  const { homeserver, accessToken } = useMatrixStore.getState();
  return { homeserver, accessToken };
}

/** Append the homeserver query parameter expected by the Matrix BFF. */
export function matrixProxyUrl(path: string, homeserver: string): string {
  const base = apiUrl(path);
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}homeserver=${encodeURIComponent(homeserver)}`;
}

/**
 * Fetch a Matrix proxy route with the current homeserver + bearer token.
 *
 * Throws a descriptive error when credentials are missing so callers surface
 * an actionable message instead of an opaque 400 from the BFF.
 */
export async function matrixProxyFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { homeserver, accessToken } = currentMatrixAuth();
  if (!homeserver) throw new Error('Matrix homeserver is not configured');
  if (!accessToken) throw new Error('Matrix access token is not available');

  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  // Only JSON string bodies get a default content type; FormData must keep
  // the browser-generated multipart boundary.
  if (typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(matrixProxyUrl(path, homeserver), {
    ...init,
    credentials: 'same-origin',
    headers,
  });
}
