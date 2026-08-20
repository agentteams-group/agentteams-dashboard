/**
 * Prepend the Next.js basePath to an API path so fetch() works
 * regardless of whether the app is deployed at root or under /dashboard.
 *
 * Also ensures trailing slash for API routes (Next.js trailingSlash: true
 * causes 308 redirects on POST requests without trailing slash).
 *
 * Usage:  fetch(apiUrl('/api/auth/login'), { ... })
 */
import { ApiError, NetworkError } from './api-error';
export function apiUrl(path: string): string {
  // NEXT_PUBLIC_BASE_PATH is baked at build time by Next.js.
  const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
  const [pathname, query] = path.split('?', 2);
  // Ensure the path has a trailing slash without mutating query values.
  const normalized = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return `${base}${normalized}${query ? `?${query}` : ''}`;
}

/** Extract a human-readable detail from an error response body.
 * The controller's standard error shape is `{ "message": "..." }`
 * (httputil.ErrorResponse); the dashboard middleware returns
 * `{ "error": "..." }`. Accept both so callers surface the real reason. */
export async function extractErrorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const payload = (await res.json()) as { error?: unknown; message?: unknown };
    const fromError =
      payload && typeof payload.error === 'string' && payload.error ? payload.error : '';
    const fromMessage =
      payload && typeof payload.message === 'string' && payload.message ? payload.message : '';
    if (fromMessage) return fromMessage;
    if (fromError) return fromError;
  } catch {
    // non-JSON error body; keep the fallback
  }
  return fallback;
}

/** GET a JSON API route via the dashboard proxy.
 *
 * Shared by all agentteams clients (projects / workers) so the
 * fetch mode (`cache: 'no-store'`) and error shape (`ApiError` with the
 * upstream status) stay consistent across the repo. Callers may pass an
 * AbortSignal to cancel the request (e.g. on component unmount); omitted =
 * never aborts (existing behavior). */
export async function requestJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', signal });
  } catch (e) {
    // Aborted requests surface as a plain Error('AbortError') — keep them
    // distinguishable from real network failures.
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new NetworkError(url);
  }
  if (!res.ok) {
    const detail = await extractErrorDetail(res, `HTTP ${res.status}`);
    throw new ApiError(`${detail} from ${url}`, res.status, url);
  }
  // Defensive: some proxy backends return HTML error pages with status 200
  // (e.g. middleware rewrites). Detect non-JSON content-type early so callers
  // surface a proper ApiError instead of an unhandled SyntaxError.
  const contentType = res.headers.get('content-type') || '';
  if (contentType && !contentType.includes('application/json')) {
    const text = await res.text().catch(() => '');
    throw new ApiError(
      `API returned non-JSON response (${contentType}): ${text.slice(0, 200)}`,
      res.status,
      url,
    );
  }
  try {
    return (await res.json()) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    throw new ApiError(
      `Failed to parse API JSON response: ${message}`,
      res.status,
      url,
      err,
    );
  }
}
