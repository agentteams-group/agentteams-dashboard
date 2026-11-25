// Human file-area client (read-only).
//
// Mirrors the controller contract in
// agentteams-controller/internal/server/human_files_handler.go:
//
//   GET /api/v1/humans/{h}/files              → {path, entries[]}   (listFiles)
//   GET /api/v1/humans/{h}/files?recursive=1  → {entries[], nextKey} (listRecursiveFiles)
//   GET /api/v1/humans/{h}/files/{path}?list=1 → {path, entries[]}   (listDirectory)
//   GET /api/v1/humans/{h}/files/{path}       → bytes               (readSingleFile)
//   GET /api/v1/humans/{h}/trash              → {entries[]}         (listTrash)
//
// Every request goes through the Next.js proxy routes under
// `/api/agentteams/humans/*`, which attach the server-side credential. The
// browser never talks to the controller directly.
//
// Two contract details drive the helpers below:
//  * the path is a *path segment*, not a `?path=` parameter, so each segment
//    must be percent-encoded individually while '/' separators survive;
//  * the trash listing reports the original path as `files/<rel>`, so the UI
//    strips that prefix to show what the user recognises.

import { ApiError, NetworkError, shortErrorMessage } from '@/lib/api-error';
import { apiUrl, requestJson } from '@/lib/api-base';
import {
  FileEtagCache,
  concatChunks,
  decideDownloadResponse,
  resumeHeaders,
  shouldPresign,
} from '@/lib/files-transfer';

/** 文件区错误：带 controller 的 code（413 区分 size_exceeded / quota_exceeded，
 * 409 区分 checksum_mismatch，412 冲突）。 */
export class HumanFilesError extends ApiError {
  readonly code?: string;

  constructor(message: string, status: number, endpoint: string, code?: string) {
    super(message, status, endpoint);
    this.name = 'HumanFilesError';
    this.code = code;
  }
}

export interface HumanFileEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  updatedAt?: string;
  /** 相对存储根的路径（无 files/ 前缀；#1518 query 端点条目）。 */
  path?: string;
  etag?: string;
}

export interface HumanFileListResponse {
  path: string;
  entries: HumanFileEntry[];
}

/** 条目相对文件根路径（老形态无 path → name）。 */
export function entryRelPath(e: HumanFileEntry): string {
  return e.path ?? e.name;
}

/** 条目显示名（path 末段优先，老形态 name）。 */
export function entryDisplayName(e: HumanFileEntry): string {
  if (e.path) {
    const segs = e.path.split('/');
    return segs[segs.length - 1] || e.name;
  }
  return e.name;
}

export function isEntryDir(e: HumanFileEntry): boolean {
  return e.type === 'directory';
}

export interface HumanFileRecursiveEntry {
  /** Path relative to the files/ root, e.g. `docs/report.md`. */
  path: string;
  size: number;
  etag?: string;
  updatedAt?: string;
}

export interface HumanFileRecursiveResponse {
  entries: HumanFileRecursiveEntry[];
  /** Key cursor for the next page; null/absent when exhausted. */
  nextKey?: string | null;
}

export interface HumanTrashEntry {
  id: string;
  /** Original path with the controller's `files/` prefix removed. */
  path: string;
  size: number;
  deletedAt: string;
  caller?: string;
  role?: string;
}

export type HumanFileErrorKind = 'forbidden' | 'hidden' | 'error';

export interface HumanFileErrorState {
  kind: HumanFileErrorKind;
  message: string;
}

/** Percent-encode one files-relative path, keeping '/' as the separator. */
export function encodeHumanFilePath(path: string): string {
  return path
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/** Dashboard proxy path for a directory ("" = the files/ root). */
export function humanFilesApiPath(name: string, dir = ''): string {
  const base = `/api/agentteams/humans/${encodeURIComponent(name)}/files`;
  const encoded = encodeHumanFilePath(dir);
  return encoded ? `${base}/${encoded}` : base;
}

/** Absolute browser URL for one file's bytes (used by the download button).
 *
 * Deliberately NOT built with `apiUrl`: that helper appends a trailing slash,
 * and a trailing slash means "list this directory" to the controller. */
export function humanFileDownloadUrl(name: string, path: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
  return `${base}${humanFilesApiPath(name, path)}`;
}

/** Parent directory of a files-relative directory ("" for the root). */
export function parentHumanDir(dir: string): string {
  const parts = dir.split('/').filter((segment) => segment !== '');
  parts.pop();
  return parts.join('/');
}

/** Breadcrumb trail for the current directory, root first. */
export function humanBreadcrumbs(dir: string): Array<{ label: string; path: string }> {
  const parts = dir.split('/').filter((segment) => segment !== '');
  const crumbs = [{ label: '文件', path: '' }];
  for (let i = 0; i < parts.length; i++) {
    crumbs.push({ label: parts[i], path: parts.slice(0, i + 1).join('/') });
  }
  return crumbs;
}

/** Join a directory and an entry name into a files-relative path. */
export function joinHumanDir(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/** A 403 is an explicit denial; a 404 deliberately hides "missing" and "not
 * visible to you" behind one response (W4 semantics), so the two need
 * different wording and must not be collapsed into a generic error. */
export function describeHumanFileError(err: unknown): HumanFileErrorState {
  const status = err instanceof ApiError ? err.status : 0;
  if (status === 403) return { kind: 'forbidden', message: '无权限访问该文件区' };
  if (status === 404) return { kind: 'hidden', message: '不存在或不可见' };
  return { kind: 'error', message: shortErrorMessage(err) || '文件区加载失败' };
}

function stripFilesPrefix(path: string): string {
  return path.replace(/^files\//, '');
}

/** Normalise the trash listing: strip the `files/` prefix, coerce the wire
 * types, and order newest first (the controller's id is time-prefixed, which
 * is also the fallback when deletedAt is missing). */
export function normalizeTrashEntries(payload: unknown): HumanTrashEntry[] {
  const container = payload as { entries?: unknown } | unknown[] | null;
  const raw = Array.isArray(container)
    ? container
    : container && typeof container === 'object' && Array.isArray(container.entries)
      ? container.entries
      : [];
  const entries: HumanTrashEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : '';
    if (!id) continue;
    const size = typeof row.size === 'number' && Number.isFinite(row.size) ? row.size : 0;
    entries.push({
      id,
      path: stripFilesPrefix(typeof row.path === 'string' ? row.path : ''),
      size,
      deletedAt: typeof row.deletedAt === 'string' ? row.deletedAt : '',
      caller: typeof row.caller === 'string' && row.caller ? row.caller : undefined,
      role: typeof row.role === 'string' && row.role ? row.role : undefined,
    });
  }
  return entries.sort((a, b) => (b.deletedAt || b.id).localeCompare(a.deletedAt || a.id));
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function formatHumanFileTime(iso: string | undefined): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function normalizeEntry(raw: unknown): HumanFileEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const rawPath = typeof row.path === 'string' ? row.path : '';
  const rel = stripFilesPrefix(rawPath).replace(/\/+$/, '');
  const size = typeof row.size === 'number' && Number.isFinite(row.size) ? row.size : 0;
  const typeExplicit = row.type === 'file' || row.type === 'directory' ? row.type : undefined;
  const isDir =
    typeExplicit === 'directory' ||
    (typeExplicit === undefined &&
      rawPath !== '' &&
      (rawPath.endsWith('/') || (row.size === undefined && row.etag === undefined)));
  const name =
    typeof row.name === 'string' && row.name
      ? row.name
      : rel
        ? rel.split('/').pop() || rel
        : '';
  if (!name) return null;
  return {
    name,
    type: isDir ? 'directory' : 'file',
    size: isDir ? 0 : size,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : undefined,
    path: rel || undefined,
    etag: typeof row.etag === 'string' ? row.etag : undefined,
  };
}

async function readError(res: Response, url: string): Promise<HumanFilesError> {
  let code: string | undefined;
  let message = `HTTP ${res.status}`;
  try {
    const text = await res.text();
    try {
      const body = JSON.parse(text) as Record<string, unknown>;
      if (typeof body.code === 'string') code = body.code;
      if (typeof body.message === 'string' && body.message) message = body.message;
      else if (typeof body.error === 'string' && body.error) message = body.error;
      else if (typeof body.detail === 'string' && body.detail) message = body.detail;
    } catch {
      if (/^[A-Za-z][A-Za-z0-9_]{1,63}$/.test(text.trim())) code = text.trim();
    }
  } catch {
    /* body unreadable */
  }
  return new HumanFilesError(message, res.status, url, code);
}

/** 预签名下载票（GET ?presign=1）。 */
export interface PresignDownloadTicket {
  url: string;
  etag?: string;
  size?: number;
  expiresAt?: string;
}

/** 预签名不可用 → 回落直下（501 = 部署未开；404/405 旧控制器；5xx 上游故障）。 */
function presignUnavailable(status: number): boolean {
  return status === 404 || status === 405 || status === 501 || status === 502 || status === 503;
}

/** 上传进度回调（0–100；null = 不确定）。 */
export type UploadProgressFn = (_percent: number | null) => void;

function xhrSend(o: {
  url: string;
  method: 'PUT' | 'POST';
  body: Blob | FormData;
  headers?: Record<string, string>;
  onProgress?: UploadProgressFn;
  signal?: AbortSignal;
}): Promise<void> {
  if (typeof XMLHttpRequest === 'undefined') {
    return fetch(o.url, { method: o.method, body: o.body, headers: o.headers, signal: o.signal }).then(
      (res) => {
        if (!res.ok) throw new HumanFilesError(`HTTP ${res.status}`, res.status, o.url, 'storage_http');
      },
    );
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(o.method, o.url, true);
    for (const [k, v] of Object.entries(o.headers ?? {})) xhr.setRequestHeader(k, v);
    if (o.onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) o.onProgress?.(Math.round((e.loaded / e.total) * 100));
        else o.onProgress?.(null);
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new HumanFilesError(`HTTP ${xhr.status}`, xhr.status, o.url, 'storage_http'));
    };
    xhr.onerror = () => reject(new HumanFilesError('网络错误', 0, o.url, 'storage_network'));
    xhr.onabort = () => reject(new HumanFilesError('已取消', 0, o.url, 'aborted'));
    if (o.signal) {
      if (o.signal.aborted) {
        reject(new HumanFilesError('已取消', 0, o.url, 'aborted'));
        return;
      }
      o.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(o.body);
  });
}

const downloadCache = new FileEtagCache();

async function readBodyWithResume(
  url: string,
  initHeaders: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ blob: Blob; etag?: string }> {
  let received = 0;
  let chunks: Uint8Array[] = [];
  let etag: string | undefined;
  let first = true;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: first ? initHeaders : resumeHeaders(received, etag),
      signal,
    });
    const decision = decideDownloadResponse({
      status: res.status,
      hasCache: false,
      received,
      etag: res.headers.get('etag'),
      contentRange: res.headers.get('content-range'),
    });
    if (decision.kind === 'restart') {
      received = 0;
      chunks = [];
      first = true;
      continue;
    }
    if (!res.ok) throw await readError(res, url);
    if (decision.kind === 'full') {
      received = 0;
      chunks = [];
    }
    etag = res.headers.get('etag') ?? etag;
    first = false;
    if (!res.body) {
      const blob = await res.blob();
      return { blob, etag };
    }
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.byteLength;
        }
      }
    } catch (err) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      if (signal?.aborted) throw err;
      continue; // 断流：带 Range 续传一次
    }
    return {
      blob: concatChunks(chunks, res.headers.get('content-type') ?? ''),
      etag,
    };
  }
  throw new NetworkError(url);
}

/** 文件区读写客户端。读走带 ETag 缓存的 GET；写走预签名/直传 + commit。 */
export const humanFilesApi = {
  listDirectory: (
    name: string,
    dir = '',
    options: { signal?: AbortSignal } = {},
  ): Promise<HumanFileListResponse> => {
    const suffix = dir ? '?list=1' : '';
    return requestJson<{ path?: string; entries?: unknown[] }>(
      apiUrl(`${humanFilesApiPath(name, dir)}${suffix}`),
      options.signal,
    ).then((payload) => ({
      path: typeof payload.path === 'string' ? payload.path : dir,
      entries: (Array.isArray(payload.entries) ? payload.entries : [])
        .map(normalizeEntry)
        .filter((e): e is HumanFileEntry => e !== null),
    }));
  },

  /** 递归平铺（#1518 query 端点；游标分页，控制器按整个文件区扫描）。 */
  listRecursive: async (
    name: string,
    options: { cursor?: string; limit?: number; signal?: AbortSignal } = {},
  ): Promise<HumanFileRecursiveResponse> => {
    const params = new URLSearchParams({ recursive: '1' });
    if (options.cursor) params.set('cursor', options.cursor);
    if (options.limit) params.set('limit', String(options.limit));
    const payload = await requestJson<{ entries?: unknown[]; nextKey?: unknown }>(
      apiUrl(`${humanFilesApiPath(name)}?${params.toString()}`),
      options.signal,
    );
    const entries: HumanFileRecursiveEntry[] = [];
    for (const raw of Array.isArray(payload.entries) ? payload.entries : []) {
      if (!raw || typeof raw !== 'object') continue;
      const row = raw as Record<string, unknown>;
      const path = stripFilesPrefix(typeof row.path === 'string' ? row.path : '');
      if (!path) continue;
      entries.push({
        path,
        size: typeof row.size === 'number' ? row.size : 0,
        etag: typeof row.etag === 'string' ? row.etag : undefined,
        updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : undefined,
      });
    }
    return {
      entries,
      nextKey: typeof payload.nextKey === 'string' ? payload.nextKey : null,
    };
  },

  listTrash: async (name: string, options: { signal?: AbortSignal } = {}): Promise<HumanTrashEntry[]> => {
    const url = apiUrl(`/api/agentteams/humans/${encodeURIComponent(name)}/trash`);
    return normalizeTrashEntries(await requestJson<unknown>(url, options.signal));
  },

  /** HEAD 元信息（ETag + 大小；不支持 HEAD → 空对象）。 */
  stat: async (name: string, path: string): Promise<{ etag?: string; size?: number }> => {
    const url = humanFileDownloadUrl(name, path);
    try {
      const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (!res.ok) return {};
      const len = res.headers.get('content-length');
      const size = len !== null && len !== '' ? Number(len) : NaN;
      return {
        etag: res.headers.get('etag') ?? undefined,
        size: Number.isFinite(size) && size >= 0 ? size : undefined,
      };
    } catch {
      return {};
    }
  },

  /** 下载：ETag 缓存命中 304 → 复用 Blob；大文件先预签名（501 → 直下）；
   * 断流按 Range 续传（206/416/If-Range）。 */
  download: async (
    name: string,
    path: string,
    options: { size?: number; onProgress?: (_percent: number | null) => void; signal?: AbortSignal } = {},
  ): Promise<Blob> => {
    const key = `${name}:${path}`;
    const url = humanFileDownloadUrl(name, path);
    const cached = downloadCache.get(key);
    if (shouldPresign(options.size) && !cached) {
      try {
        const ticket = await humanFilesApi.presignDownload(name, path);
        if (ticket.ok) {
          const res = await fetch(ticket.value.url, { signal: options.signal });
          if (res.ok) {
            const blob = await res.blob();
            const etag = ticket.value.etag ?? res.headers.get('etag');
            if (etag) downloadCache.set(key, { blob, etag });
            options.onProgress?.(100);
            return blob;
          }
        }
      } catch {
        /* 预签名失败/跨域 → 回落直下 */
      }
    }
    const headers: Record<string, string> = {};
    if (cached?.etag) headers['If-None-Match'] = cached.etag;
    let res: Response;
    try {
      res = await fetch(url, { cache: 'no-store', headers, signal: options.signal });
    } catch (err) {
      if (options.signal?.aborted) throw err;
      const resumed = await readBodyWithResume(url, headers, options.signal);
      if (resumed.etag) downloadCache.set(key, { blob: resumed.blob, etag: resumed.etag });
      return resumed.blob;
    }
    if (res.status === 304 && cached) {
      options.onProgress?.(100);
      return cached.blob;
    }
    if (res.status === 206) {
      // 服务端直接给了分片：按全量读取路径拼装（起点 0 才完整）。
      const decision = decideDownloadResponse({
        status: res.status,
        hasCache: false,
        received: 0,
        contentRange: res.headers.get('content-range'),
      });
      if (decision.kind !== 'append') throw await readError(res, url);
      const blob = await res.blob();
      return blob;
    }
    if (!res.ok) throw await readError(res, url);
    try {
      const blob = await res.blob();
      const etag = res.headers.get('etag');
      if (etag) downloadCache.set(key, { blob, etag });
      options.onProgress?.(100);
      return blob;
    } catch (err) {
      if (options.signal?.aborted) throw err;
      // 断流 → 从 0 重试（带 Range 续传的完整路径在 readBodyWithResume）。
      const resumed = await readBodyWithResume(url, headers, options.signal);
      if (resumed.etag) downloadCache.set(key, { blob: resumed.blob, etag: resumed.etag });
      return resumed.blob;
    }
  },

  presignDownload: async (
    name: string,
    path: string,
  ): Promise<
    { ok: true; value: PresignDownloadTicket } | { ok: false; status: number; message: string }
  > => {
    const url = `${humanFileDownloadUrl(name, path)}?presign=1`;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        const err = await readError(res, url);
        return { ok: false, status: err.status, message: err.message };
      }
      const body = (await res.json()) as Record<string, unknown>;
      if (typeof body.url !== 'string' || !body.url) {
        return { ok: false, status: 501, message: 'presign_unsupported' };
      }
      return {
        ok: true,
        value: {
          url: body.url,
          etag: typeof body.etag === 'string' ? body.etag : undefined,
          size: typeof body.size === 'number' ? body.size : undefined,
          expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : undefined,
        },
      };
    } catch {
      return { ok: false, status: 0, message: '网络错误' };
    }
  },

  /** 读文本 + 同一 GET 的 ETag（在线编辑打开用；不走 304 缓存）。 */
  readText: async (name: string, path: string): Promise<{ text: string; etag?: string }> => {
    const url = humanFileDownloadUrl(name, path);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw await readError(res, url);
    return { text: await res.text(), etag: res.headers.get('etag') ?? undefined };
  },

  /** 直传（PUT；If-Match = 乐观并发；不带 = 覆盖）。 */
  writeFile: async (
    name: string,
    path: string,
    content: Blob | string,
    options: { ifMatch?: string; onProgress?: UploadProgressFn; signal?: AbortSignal } = {},
  ): Promise<{ path: string; size: number; etag: string }> => {
    const url = humanFileDownloadUrl(name, path);
    const body = typeof content === 'string' ? new Blob([content]) : content;
    const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
    if (options.ifMatch) headers['If-Match'] = options.ifMatch;
    const res = await fetch(url, { method: 'PUT', headers, body, signal: options.signal });
    if (!res.ok) throw await readError(res, url);
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      /* 空 body */
    }
    return {
      path: typeof data.path === 'string' ? stripFilesPrefix(data.path) : path,
      size: typeof data.size === 'number' ? data.size : body.size,
      etag: typeof data.etag === 'string' ? data.etag : '',
    };
  },

  /** 新建文件夹：写 `<dir>/.keep` 占位（列表隐藏该标记对象）。 */
  makeDirectory: async (name: string, dir: string): Promise<void> => {
    const clean = dir.replace(/^\/+|\/+$/g, '');
    if (!clean) return;
    await humanFilesApi.writeFile(name, `${clean}/.keep`, new Blob([]));
  },

  deleteFile: async (name: string, path: string): Promise<{ trashId: string }> => {
    const url = humanFileDownloadUrl(name, path);
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw await readError(res, url);
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      /* 空 body */
    }
    return { trashId: typeof data.trashId === 'string' ? data.trashId : '' };
  },

  restoreTrash: async (name: string, id: string, overwrite = false): Promise<void> => {
    const base = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/api/agentteams/humans/${encodeURIComponent(name)}/trash/${encodeURIComponent(id)}/restore/`;
    const res = await fetch(overwrite ? `${base}?overwrite=1` : base, { method: 'POST' });
    if (!res.ok) throw await readError(res, base);
  },

  purgeTrash: async (name: string, id: string): Promise<void> => {
    const url = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/api/agentteams/humans/${encodeURIComponent(name)}/trash/${encodeURIComponent(id)}/`;
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw await readError(res, url);
  },

  getQuota: async (
    name: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<{ usedBytes: number; quotaBytes: number | null }> => {
    const url = apiUrl(`/api/agentteams/humans/${encodeURIComponent(name)}/quota`);
    const payload = await requestJson<{ usedBytes?: unknown; quotaBytes?: unknown }>(
      url,
      options.signal,
    );
    return {
      usedBytes: typeof payload.usedBytes === 'number' ? payload.usedBytes : 0,
      quotaBytes: typeof payload.quotaBytes === 'number' ? payload.quotaBytes : null,
    };
  },

  setQuota: async (name: string, bytes: number | null): Promise<void> => {
    const url = apiUrl(`/api/agentteams/humans/${encodeURIComponent(name)}/quota`);
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quotaBytes: bytes }),
    });
    if (!res.ok) throw await readError(res, url);
  },

  /** 上传：预签名（PUT/POST 对象 → commit）不可用时回落直传；支持取消/进度。 */
  uploadFile: async (
    name: string,
    path: string,
    file: File | Blob,
    options: { onProgress?: UploadProgressFn; signal?: AbortSignal; fileName?: string } = {},
  ): Promise<{ path: string; size: number; etag: string; via: 'presign' | 'direct' }> => {
    const encoded = encodeHumanFilePath(path);
    const base = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/api/agentteams/humans/${encodeURIComponent(name)}/files/${encoded}`;
    let ticket: Record<string, unknown> | null = null;
    let presignStatus = 0;
    let presignMessage = '';
    try {
      const res = await fetch(`${base}/?presign=1`, { method: 'POST', signal: options.signal });
      if (res.ok) ticket = (await res.json()) as Record<string, unknown>;
      else {
        const err = await readError(res, base);
        presignStatus = err.status;
        presignMessage = err.message;
      }
    } catch {
      presignStatus = 0;
    }
    if (ticket && typeof ticket.url === 'string') {
      const method = ticket.method === 'POST' ? 'POST' : 'PUT';
      const fields =
        ticket.fields && typeof ticket.fields === 'object'
          ? (ticket.fields as Record<string, string>)
          : {};
      const maxBytes = typeof ticket.maxBytes === 'number' ? ticket.maxBytes : undefined;
      if (typeof maxBytes === 'number' && maxBytes > 0 && file.size > maxBytes) {
        throw new HumanFilesError(String(maxBytes), 413, base, 'max_bytes');
      }
      if (method === 'PUT') {
        // 不设 Content-Type：S3 签名头不含它，带上会 403。
        await xhrSend({ url: String(ticket.url), method, body: file, onProgress: options.onProgress, signal: options.signal });
      } else {
        const fd = new FormData();
        for (const [k, v] of Object.entries(fields)) fd.append(k, v);
        fd.append('file', file, options.fileName ?? path.split('/').pop() ?? 'file');
        await xhrSend({ url: String(ticket.url), method: 'POST', body: fd, onProgress: options.onProgress, signal: options.signal });
      }
      const commitUrl = `${base}/commit/`;
      const res = await fetch(commitUrl, { method: 'POST', signal: options.signal });
      if (!res.ok) throw await readError(res, commitUrl);
      let data: Record<string, unknown> = {};
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        /* 空 body */
      }
      return {
        path: typeof data.path === 'string' ? stripFilesPrefix(data.path) : path,
        size: typeof data.size === 'number' ? data.size : file.size,
        etag: typeof data.etag === 'string' ? data.etag : '',
        via: 'presign',
      };
    }
    if (presignUnavailable(presignStatus) || presignStatus === 0) {
      const direct = await humanFilesApi.writeFile(name, path, file, {
        onProgress: options.onProgress,
        signal: options.signal,
      });
      return { ...direct, via: 'direct' };
    }
    throw new HumanFilesError(presignMessage || `HTTP ${presignStatus}`, presignStatus, base);
  },
};

/** 触发浏览器保存（a[download]）。 */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
