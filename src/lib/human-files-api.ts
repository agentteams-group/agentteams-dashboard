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
import { apiUrl, extractErrorDetail, requestJson } from '@/lib/api-base';

export interface HumanFileEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  updatedAt?: string;
}

export interface HumanFileListResponse {
  path: string;
  entries: HumanFileEntry[];
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

// Kept as an object (not bare exported functions) so tests can spy on it the
// same way existing panels spy on `agentteamsApi`.
export const humanFilesApi = {
  listDirectory: (name: string, dir = ''): Promise<HumanFileListResponse> => {
    const suffix = dir ? '?list=1' : '';
    return requestJson<HumanFileListResponse>(apiUrl(`${humanFilesApiPath(name, dir)}${suffix}`));
  },

  listRecursive: (
    name: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<HumanFileRecursiveResponse> => {
    const params = new URLSearchParams({ recursive: '1' });
    if (options.cursor) params.set('cursor', options.cursor);
    if (options.limit) params.set('limit', String(options.limit));
    return requestJson<HumanFileRecursiveResponse>(
      apiUrl(`${humanFilesApiPath(name)}?${params.toString()}`),
    );
  },

  listTrash: async (name: string): Promise<HumanTrashEntry[]> => {
    const url = apiUrl(`/api/agentteams/humans/${encodeURIComponent(name)}/trash`);
    return normalizeTrashEntries(await requestJson<unknown>(url));
  },

  download: async (name: string, path: string): Promise<Blob> => {
    const url = humanFileDownloadUrl(name, path);
    let res: Response;
    try {
      res = await fetch(url, { cache: 'no-store' });
    } catch (err) {
      throw new NetworkError(url, err);
    }
    if (!res.ok) {
      const detail = await extractErrorDetail(res, `HTTP ${res.status}`);
      throw new ApiError(detail, res.status, url);
    }
    return res.blob();
  },
};
