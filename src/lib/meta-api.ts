// 项目/任务 meta（meta.json）读写域 — 对齐工作台插件 16.113 契约。
//
// 端点（Controller，逐字）：
//   GET /api/v1/projects/{id}/meta   200 = meta.json 原文（不重排）+ ETag 响应头
//                                    404 = 项目不存在/无权（W4 不泄露）
//   PUT /api/v1/projects/{id}/meta   必带 If-Match（缺失 → 428）；不匹配 → 409
//                                    {"code":"conflict"}；200 → 新内容 ETag
//   GET/PUT /api/v1/tasks/{id}/meta  同项目契约；同 id 跨多团队 →
//                                    409 {"code":"ambiguous_task"}，需 ?team= 重试
//   老 Controller（路由未部署）→ 405 → 入口静默隐藏（不报错）
//
// 传输走裸 fetch：① 200 body 是 meta.json 原文，逐字显示/原样写回（json()
// 会丢格式）；② 409 body 的 code 是区分 conflict / ambiguous_task 的唯一依据。
// ETag/If-Match 是响应头/请求头，不经过 JSON 封装。

import { ApiError, NetworkError } from './api-error';
import { apiUrl } from './api-base';

/** meta.json 体量上限（与入口「大文本提示/拒绝」共用）。 */
export const META_MAX_BYTES = 256 * 1024;

/** meta 请求错误：显式携带 status + 409 body 的 code。 */
export class MetaApiError extends ApiError {
  /** 409 body 的 code："conflict" | "ambiguous_task"。 */
  readonly code?: string;

  constructor(message: string, status: number, endpoint: string, code?: string) {
    super(message, status, endpoint);
    this.name = 'MetaApiError';
    this.code = code;
  }
}

export type MetaErrorKind =
  | 'unsupported' // 405：老 Controller 路由未部署
  | 'conflict' // 409：If-Match 不匹配
  | 'ambiguous' // 409 ambiguous_task：同 id 跨多团队
  | 'not_found' // 404：目标不存在（同样按端点不可用处理，入口隐藏）
  | 'forbidden' // 401/403
  | 'other'; // 428/5xx/网络等

function metaErrorStatus(e: unknown): number | undefined {
  if (e !== null && typeof e === 'object') {
    const status = (e as { status?: unknown }).status;
    if (typeof status === 'number') return status;
  }
  const message = e instanceof Error ? e.message : '';
  const match = /HTTP (\d{3})/.exec(message);
  return match ? Number(match[1]) : undefined;
}

function metaErrorCode(e: unknown): string | undefined {
  if (e !== null && typeof e === 'object') {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/** 错误分类（纯函数，可测）。 */
export function classifyMetaError(e: unknown): MetaErrorKind {
  const status = metaErrorStatus(e);
  if (status === 405) return 'unsupported';
  if (status === 404) return 'not_found';
  if (status === 409) {
    return metaErrorCode(e) === 'ambiguous_task' ? 'ambiguous' : 'conflict';
  }
  if (status === 401 || status === 403) return 'forbidden';
  return 'other';
}

/** 端点不可用（405 未部署 / 404 目标消失）：入口隐藏 + 静默降级。 */
export function isMetaEndpointUnavailable(e: unknown): boolean {
  const kind = classifyMetaError(e);
  return kind === 'unsupported' || kind === 'not_found';
}

export type MetaValidationError = 'empty' | 'invalid_json' | 'not_object' | 'oversize';

/** meta 编辑器校验（纯函数）：必须是 JSON 对象；空对象 {} 合法（= 清空）。
 *  空串 / 非法 JSON / 数组 / 标量 / 超 256 KiB 一律拒绝保存（行内红字）。 */
export function validateMetaJson(
  text: string,
): { ok: true } | { ok: false; error: MetaValidationError } {
  if (new TextEncoder().encode(text).byteLength > META_MAX_BYTES) {
    return { ok: false, error: 'oversize' };
  }
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, error: 'empty' };
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: 'invalid_json' };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'not_object' };
  }
  return { ok: true };
}

/** 请求头（纯函数）：PUT 必须带 If-Match（缺失服务端 428）。 */
export function buildMetaHeaders(
  method: 'GET' | 'PUT',
  ifMatch?: string,
): Record<string, string> {
  if (method !== 'PUT') return {};
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (ifMatch) headers['If-Match'] = ifMatch;
  return headers;
}

/** 编辑器展示文本：空 meta → `{}`；合法 JSON → pretty；非法原文原样返回。 */
export function formatMetaText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return '{}';
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return raw;
  }
}

export interface MetaReadResult {
  /** meta.json 原文（逐字，不重排）。 */
  raw: string;
  /** ETag（PUT 的 If-Match 值；老 Controller 可能为空）。 */
  etag: string;
}

const BASE = '/agentteams';

async function metaRequest(
  path: string,
  init: { method: 'GET' | 'PUT'; body?: string; ifMatch?: string },
): Promise<MetaReadResult> {
  let res: Response;
  try {
    res = await fetch(apiUrl(`/api${BASE}${path}`), {
      method: init.method,
      headers: buildMetaHeaders(init.method, init.ifMatch),
      body: init.body,
      cache: 'no-store',
    });
  } catch (err) {
    throw new NetworkError(path, err);
  }

  const raw = await res.text().catch(() => '');
  const etag = res.headers.get('etag') ?? '';

  if (!res.ok) {
    let code: string | undefined;
    let detail = '';
    try {
      const payload: unknown = raw ? JSON.parse(raw) : null;
      if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
        const body = payload as Record<string, unknown>;
        if (typeof body.code === 'string') code = body.code;
        if (typeof body.message === 'string') detail = body.message;
        else if (typeof body.detail === 'string') detail = body.detail;
        else if (typeof body.error === 'string') detail = body.error;
      }
    } catch {
      detail = raw.slice(0, 160);
    }
    throw new MetaApiError(
      detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`,
      res.status,
      path,
      code,
    );
  }

  return { raw, etag };
}

/** GET 项目 meta。 */
export function getProjectMeta(id: string): Promise<MetaReadResult> {
  return metaRequest(`/projects/${encodeURIComponent(id)}/meta`, { method: 'GET' });
}

/** PUT 项目 meta（body = 新原文；If-Match = GET 读回的 ETag）。 */
export function saveProjectMeta(id: string, raw: string, etag: string): Promise<MetaReadResult> {
  return metaRequest(`/projects/${encodeURIComponent(id)}/meta`, {
    method: 'PUT',
    body: raw,
    ifMatch: etag,
  });
}

/** GET 任务 meta（?team= 消歧：同 id 跨多团队时 409 ambiguous_task）。 */
export function getTaskMeta(id: string, team?: string): Promise<MetaReadResult> {
  const qs = team ? `?team=${encodeURIComponent(team)}` : '';
  return metaRequest(`/tasks/${encodeURIComponent(id)}/meta${qs}`, { method: 'GET' });
}

/** PUT 任务 meta（与项目同契约；?team= 消歧）。 */
export function saveTaskMeta(
  id: string,
  raw: string,
  etag: string,
  team?: string,
): Promise<MetaReadResult> {
  const qs = team ? `?team=${encodeURIComponent(team)}` : '';
  return metaRequest(`/tasks/${encodeURIComponent(id)}/meta${qs}`, {
    method: 'PUT',
    body: raw,
    ifMatch: etag,
  });
}
