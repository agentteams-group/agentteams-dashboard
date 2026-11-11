export class ApiError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly cause?: unknown;

  constructor(message: string, status: number, endpoint: string, cause?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.endpoint = endpoint;
    this.cause = cause;
  }

  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  get isServerError(): boolean {
    return this.status >= 500;
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

export class NetworkError extends ApiError {
  constructor(endpoint: string, cause?: unknown) {
    super('网络请求失败，请检查连接', 0, endpoint, cause);
    this.name = 'NetworkError';
  }
}

/**
 * True when the backend does not expose the requested endpoint at all
 * (404 Not Found / 405 Method Not Allowed), e.g. AgentTeams v1.2.0-beta.1
 * lacks GET /api/v1/gateway/consumers and PUT /api/v1/humans/{name}.
 */
export function isUnsupportedEndpointError(err: unknown): err is ApiError {
  return err instanceof ApiError && (err.status === 404 || err.status === 405);
}

/**
 * proxyRequest wraps failures as `API Error 502: {json}` (or the upstream's
 * `HTTP 502: ...`). Pull the human field out of a JSON error body so dialogs
 * show the controller/proxy message instead of a bare status + raw JSON.
 * Returns the original message untouched when there is no JSON payload.
 */
function errorBodyDetail(message: string): { text: string; upstreamStatus?: number } {
  const match = /^(?:API Error|HTTP)\s+\d{3}:\s*([\s\S]*)$/.exec(message);
  if (!match) return { text: message };
  const body = match[1].trim();
  if (!body.startsWith('{')) return { text: body || message };
  try {
    const payload = JSON.parse(body) as Record<string, unknown>;
    const text =
      (typeof payload.message === 'string' && payload.message) ||
      (typeof payload.error === 'string' && payload.error) ||
      (typeof payload.detail === 'string' && payload.detail) ||
      body;
    const upstreamStatus =
      typeof payload.upstream_status === 'number' ? payload.upstream_status : undefined;
    return { text, upstreamStatus };
  } catch {
    return { text: body };
  }
}

export function formatErrorMessage(err: unknown, fallback = '操作失败'): string {
  if (err instanceof ApiError) {
    if (err.isNetworkError) return err.message;
    const { text, upstreamStatus } = errorBodyDetail(err.message);
    // 代理已改写上游 HTML 兜底时 status/upstream_status 相同；只有真正不同才标注。
    const upstream =
      upstreamStatus && upstreamStatus !== err.status ? `（upstream ${upstreamStatus}）` : '';
    if (err.isClientError) return `${text}${upstream}`;
    if (err.isServerError) return `服务器错误 (${err.status}): ${text}${upstream}`;
    return `${text}${upstream}`;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

/**
 * Short display message for consumer panels: strips the " from <url>" suffix
 * that requestJson appends to ApiError messages, so the UI shows the real
 * reason without the endpoint path.
 */
export function shortErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/ from .*$/, '');
}

/**
 * Unified load-failure message for read-only consumer panels (project
 * timeline / project history). A 404 means the Controller does not expose
 * the endpoint yet (pre-upgrade) — show the actionable "active after
 * Controller upgrade" placeholder instead of a raw error. Both panels MUST
 * use this helper so the 404 fallback wording stays identical.
 */
export function loadErrorMessage(e: unknown, noun: string): string {
  if (e instanceof ApiError && e.status === 404) return 'Controller 升级后自动生效';
  return `${noun}：${shortErrorMessage(e)}`;
}

/**
 * Human-readable message for a failed worker delete. A 409 from the controller
 * usually means the worker is still attached to a team; turn the raw JSON error
 * into an actionable hint (which team to detach it from) instead of dumping the
 * whole "API Error 409: {...}" payload.
 */
export function describeWorkerDeleteError(err: unknown, workerName: string): string {
  if (err instanceof ApiError && err.status === 409) {
    const match = /member of team ([^;"\s]+)/.exec(err.message);
    if (match) {
      return `Worker "${workerName}" 属于团队 "${match[1]}"，请先在团队详情中将其移出后再删除`;
    }
  }
  return formatErrorMessage(err);
}
