/**
 * F7 stateless terminal state — client-side credential injection.
 *
 * A single window.fetch patch injects the browser's own bearer token into
 * same-origin data-plane requests that do not already carry an
 * Authorization header:
 *
 *   token priority = at_cfg.controller_token (the user's optional L1 full
 *   view — plugin controller_token parity) > matrix-store access token.
 *
 * The patch is deliberately INERT in stateful mode: the server's session /
 * SA credentials always win in proxyToAgentTeams (token-injection
 * protection, upstream #89), so an injected browser header there is simply
 * ignored by the server. One code path serves both deployment shapes.
 *
 * 401 handling (data plane only): the middleware / Controller answered 401
 * for a request we authenticated — the credential is expired or revoked.
 * Clear the browser credentials and bounce to the entry page (which shows
 * the stateless login form). /api/auth/* responses are excluded on purpose:
 * a 401 from the stateful login form means "wrong password" and must keep
 * rendering its inline error, not bounce.
 */

import { useMatrixStore } from './matrix-store';
import { useAgentTeamsStore } from './agentteams-store';
import { loadClientConfig } from './client-config-store';

let installed = false;
let redirecting = false;

/** The credential the browser presents on the data plane (F7 priority). */
export function activeClientBearerToken(): string | null {
  if (typeof window === 'undefined') return null;
  const cfg = loadClientConfig();
  if (cfg?.controller_token) return cfg.controller_token;
  const matrix = useMatrixStore.getState();
  if (matrix.isLoggedIn && matrix.accessToken) return matrix.accessToken;
  return null;
}

function isDataPlaneUrl(url: string): boolean {
  return url.startsWith('/api/agentteams/') || url.startsWith('/api/auth/');
}

function clearClientCredentials(): void {
  try {
    // Canonical clear: also invalidates in-flight /sync loops (syncGeneration),
    // so a long-poll response arriving after the bounce cannot restart the
    // loop with the dead token.
    useMatrixStore.getState().logout();
  } catch {
    /* store not ready */
  }
}

/** Install the patch once (idempotent). Call from a client component effect. */
export function installClientAuthFetch(): void {
  if (typeof window === 'undefined' || installed) return;
  installed = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    let url = '';
    try {
      url = typeof input === 'string'
        ? input
        : input instanceof URL ? input.toString() : input.url;
    } catch {
      return originalFetch(input, init);
    }
    // Absolute URLs are compared against the origin; relative URLs are
    // already same-origin by construction.
    let sameOrigin = true;
    if (/^https?:\/\//i.test(url)) {
      try {
        sameOrigin = new URL(url).origin === window.location.origin;
      } catch {
        sameOrigin = false;
      }
    }
    const dataUrl = sameOrigin && isDataPlaneUrl(url);

    const headers = new Headers(init?.headers);
    if (input instanceof Request && !headers.get('authorization')) {
      const fromRequest = input.headers.get('authorization');
      if (fromRequest) headers.set('authorization', fromRequest);
    }
    if (dataUrl && !headers.get('authorization')) {
      const token = activeClientBearerToken();
      if (token) headers.set('authorization', `Bearer ${token}`);
    }
    // The homeserver the credential was issued by (server-validated at
    // login) — the server's identity probe prefers it over its own env
    // candidates, so a multi-homeserver deployment probes the right one.
    if (dataUrl && !headers.get('x-agentteams-homeserver')) {
      const st = useMatrixStore.getState();
      if (st.isLoggedIn && st.homeserver) {
        headers.set('x-agentteams-homeserver', st.homeserver);
      }
    }

    const authenticatedRequest = headers.has('authorization') || Boolean(useAgentTeamsStore.getState().sessionUser);
    const response = await originalFetch(input, { ...init, headers });

    if (
      dataUrl &&
      response.status === 401 &&
      url.startsWith('/api/agentteams/') &&
      authenticatedRequest &&
      !redirecting
    ) {
      redirecting = true;
      clearClientCredentials();
      window.location.replace('/?reason=unauthorized');
    }
    return response;
  }) as typeof fetch;
}

/** Test hook: reset the idempotency flag (the patch itself is per-realm). */
export function __resetClientAuthFetchForTests(): void {
  installed = false;
  redirecting = false;
}
