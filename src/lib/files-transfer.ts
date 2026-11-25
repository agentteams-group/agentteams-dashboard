// 下载缓存 / Range 续传 / 上传分片的纯逻辑（无 React、无 DOM 依赖）。
//
// #1544 能力：GET 命中 ETag 时控制器 304（不读 body）；Range 请求返回 206、
// 越界 416、If-Range 不匹配则回 200 全量。这里把「该走哪个分支」收敛成
// 纯函数，传输层只负责照做。

/** 大文件走预签名下载的门槛（8 MiB）。 */
export const PRESIGN_THRESHOLD_BYTES = 8 * 1024 * 1024;

export function shouldPresign(size: number | undefined): boolean {
  return typeof size === 'number' && Number.isFinite(size) && size >= PRESIGN_THRESHOLD_BYTES;
}

interface CacheEntry {
  blob: Blob;
  etag: string;
}

/** 进程内 LRU（默认 50 条；key = `${human}:${path}`）。 */
export class FileEtagCache {
  private readonly max: number;
  private readonly map = new Map<string, CacheEntry>();

  constructor(max = 50) {
    this.max = max;
  }

  get(key: string): CacheEntry | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    // 触碰即刷新 LRU 顺序。
    this.map.delete(key);
    this.map.set(key, hit);
    return hit;
  }

  set(key: string, entry: CacheEntry): void {
    if (!entry.etag) return;
    this.map.delete(key);
    this.map.set(key, entry);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

export type ContentRange = { start: number; end: number; total: number | null };

/** 解析 `bytes 100-199/2000`（非法 → null）。 */
export function parseContentRange(header: string | null | undefined): ContentRange | null {
  if (!header) return null;
  const m = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(header.trim());
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  const total = m[3] === '*' ? null : Number(m[3]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return null;
  return { start, end, total };
}

export type DownloadDecision =
  | { kind: 'reuse-cache' }
  | { kind: 'append'; headers: Record<string, string> }
  | { kind: 'restart'; headers: Record<string, string> }
  | { kind: 'full' };

/** 下载响应分流：
 *  304 → 复用本地缓存；
 *  206 → 校验 Content-Range 起点与已收字节一致才 append；
 *  416 → 从头重启；
 *  其它 → 全量。 */
export function decideDownloadResponse(o: {
  status: number;
  hasCache: boolean;
  received: number;
  etag?: string | null;
  contentRange?: string | null;
}): DownloadDecision {
  if (o.status === 304) return { kind: 'reuse-cache' };
  if (o.status === 206) {
    const range = parseContentRange(o.contentRange);
    if (range && range.start === o.received) {
      return {
        kind: 'append',
        headers: { Range: `bytes=${o.received}-` },
      };
    }
    return { kind: 'restart', headers: {} };
  }
  if (o.status === 416) return { kind: 'restart', headers: {} };
  return { kind: 'full' };
}

/** 续传请求头：Range 起点 + If-Range（服务端版本变了就回 200 全量）。 */
export function resumeHeaders(received: number, etag?: string | null): Record<string, string> {
  const headers: Record<string, string> = { Range: `bytes=${received}-` };
  if (etag) headers['If-Range'] = etag;
  return headers;
}

/** 拼接分片（保持顺序；空数组 → 空 Blob）。 */
export function concatChunks(chunks: readonly Uint8Array[], type = ''): Blob {
  if (chunks.length === 0) return new Blob([], { type });
  return new Blob([...chunks] as BlobPart[], { type });
}

/** 上传分片进度百分比（total 未知/为 0 → null = 不确定态）。 */
export function uploadPercent(loaded: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((loaded / total) * 100)));
}
