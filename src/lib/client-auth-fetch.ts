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
 * 401 handling (data plane only): a 401 is NOT automatically a dead session.
 * The Controller also answers 401 for permission denials and upstream/auth
 * gateway rejections on paths such as /api/agentteams/workers/.../skills;
 * clearing the session on those made a valid login look broken ("sometimes
 * clicking never works"). Only a confirmed-dead session is cleared:
 *   1. ask /api/auth/session (with the same credential) — authenticated:false
 *      is authoritative; authenticated:true always protects the session, even
 *      when the data body says "unauthorized";
 *   2. if the session endpoint cannot answer, fall back to the response body's
 *      session-invalid semantics (Unauthorized / session / at_dash_sess /
 *      not authenticated / invalid session).
 * When the session is dead: clear BOTH credential stores, then bounce to the
 * entry page (which shows the login form):
 *   1. POST /api/auth/logout/ — the stateful HttpOnly session cookie
 *      (at_dash_sess) lives server-side; clearing only the browser Matrix
 *      store leaves it valid, so the reloaded page authenticates again, the
 *      data request 401s again and the bounce repeats forever.
 *   2. the browser Matrix store.
 * /api/auth/* responses are excluded on purpose: a 401 from the stateful
 * login form means "wrong password" and must keep rendering its inline
 * error, not bounce.
 *
 * Bounce loop guard: a data-plane 401 that survives the bounce (Controller
 * credential missing/revoked, gateway auth rejecting) must not reload
 * forever — the bounce timestamp is kept in sessionStorage (it outlives the
 * reload) and a second 401 within AUTH_BOUNCE_WINDOW_MS is handed back to
 * the caller so the page can show an actionable error instead.
 */

import { useMatrixStore } from './matrix-store';
import { useAgentTeamsStore } from './agentteams-store';
import { loadClientConfig } from './client-config-store';
import { apiUrl } from './api-base';

let installed = false;
let redirecting = false;

const AUTH_BOUNCE_KEY = 'at_auth_bounce_at';
const AUTH_BOUNCE_WINDOW_MS = 10_000;

/** Did we already bounce the page within the last few seconds? */
function bouncedRecently(): boolean {
  try {
    const raw = window.sessionStorage.getItem(AUTH_BOUNCE_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < AUTH_BOUNCE_WINDOW_MS;
  } catch {
    return false; // storage unavailable — never block the bounce
  }
}

function markBounced(): void {
  try {
    window.sessionStorage.setItem(AUTH_BOUNCE_KEY, String(Date.now()));
  } catch {
    /* storage unavailable — the in-realm `redirecting` flag still guards */
  }
}

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

/**
 * Clear the SERVER-side session (HttpOnly at_dash_sess cookie + session
 * record). Best effort: a failed logout must not stop the bounce.
 * Goes through the un-patched fetch so the logout response cannot re-enter
 * this 401 handler.
 */
async function clearServerSession(fetchImpl: typeof fetch): Promise<void> {
  try {
    await fetchImpl(apiUrl('/api/auth/logout/'), {
      method: 'POST',
      credentials: 'same-origin',
    });
  } catch {
    /* offline / route missing — the bounce still has to happen */
  }
}

/** Body markers that a *session* layer (not an upstream API) rejected us. */
const SESSION_INVALID_MARKERS = [
  'unauthorized',
  'session',
  'at_dash_sess',
  'not authenticated',
  'invalid session',
];

/** Does the 401 body carry session-invalid semantics? (read from a clone) */
async function bodyIndicatesInvalidSession(response: Response): Promise<boolean> {
  try {
    const text = (await response.clone().text()).toLowerCase();
    return SESSION_INVALID_MARKERS.some((marker) => text.includes(marker));
  } catch {
    return false;
  }
}

type SessionProbe = 'valid' | 'invalid' | 'unknown';

/**
 * Ask the session endpoint whether the credential behind this browser is
 * still alive. Sent with the same headers as the failed data request so the
 * stateless (bearer-token) mode resolves the same identity. A transport
 * failure or 5xx is 'unknown' — never grounds for a logout.
 */
async function probeSessionState(
  fetchImpl: typeof fetch,
  headers: Headers,
): Promise<SessionProbe> {
  try {
    const res = await fetchImpl(apiUrl('/api/auth/session'), {
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!res.ok) return 'unknown';
    const data = (await res.json()) as { authenticated?: boolean; reason?: string };
    if (data.authenticated === true) return 'valid';
    if (data.authenticated === false) {
      // 'unreachable' means the backend could not be asked, and
      // 'no-credential' means the probe itself carried none — neither proves
      // the stored session is dead.
      if (data.reason === 'unreachable' || data.reason === 'no-credential') return 'unknown';
      return 'invalid';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Only a confirmed-dead session may be cleared. An upstream/permission 401
 * while the session is valid is returned to the page untouched.
 */
async function shouldClearSession(
  fetchImpl: typeof fetch,
  response: Response,
  headers: Headers,
): Promise<boolean> {
  const bodyInvalid = await bodyIndicatesInvalidSession(response);
  const probe = await probeSessionState(fetchImpl, headers);
  if (probe === 'valid') return false;
  if (probe === 'invalid') return true;
  return bodyInvalid;
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
      // Already bounced moments ago and the data plane still rejects the
      // credential: reloading again would loop forever. Hand the 401 back to
      // the caller so the page renders an actionable error.
      if (bouncedRecently()) return response;
      // Permission/upstream 401s are not a dead session: keep the response
      // for the page and leave the credentials alone.
      if (!(await shouldClearSession(originalFetch, response, headers))) return response;
      redirecting = true;
      markBounced();
      await clearServerSession(originalFetch);
      clearClientCredentials();
      window.location.replace('/?reason=unauthorized&from=data401');
    }
    return response;
  }) as typeof fetch;
}

/** Test hook: reset the idempotency flag (the patch itself is per-realm). */
export function __resetClientAuthFetchForTests(): void {
  installed = false;
  redirecting = false;
  try {
    window.sessionStorage.removeItem(AUTH_BOUNCE_KEY);
  } catch {
    /* storage unavailable */
  }
}
