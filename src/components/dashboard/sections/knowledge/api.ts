// 知识库数据面（自 knowledge-section.tsx 拆分，A5 纯重构）。
// /api/agentteams/workers/[name]/workspace-files/{tree|file-metadata|file-content}
// 后端=Controller Docker 代理 tarball 只读（route.ts 内注释）——
// 404=真实故障（容器/工作区缺失），直接显示服务端错误。

import { assembleGraph } from './graph';
import {
  base,
  CHUNK,
  MAX_CHUNKS,
} from './shared';
import type { FileContentResponse, GEdge, GNode, TreeEntry, TreeResponse } from './types';

/** 服务端错误消息提取（401=会话过期友好文案；正文 error/message 优先，解析失败退回状态码）。 */
async function httpError(res: Response, what: string): Promise<Error> {
  if (res.status === 401) return new Error('登录已过期，请刷新页面重新登录');
  let detail = '';
  try {
    const b = (await res.json()) as { error?: string; message?: string };
    if (b?.error) detail = b.error;
    else if (b?.message) detail = b.message;
  } catch { /* 非 JSON 错误体，保留状态码消息 */ }
  return new Error(`${what} → ${detail || `HTTP ${res.status}`}`);
}

/**
 * 成功路径同样容错：网关冷启动/登录失效时可能以 200 回 HTML 页面，
 * 直接 res.json() 会抛「Unexpected token '<'」这类不可读错误。
 */
async function jsonBody<T>(res: Response, what: string): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(
      `${what} → 服务返回了非预期的页面而非 JSON（可能登录已过期或网关异常），请刷新页面重新登录`,
    );
  }
}

export async function fetchTree(worker: string, dir: string): Promise<TreeEntry[]> {
  let cursor: string | null = null;
  const out: TreeEntry[] = [];
  for (let page = 0; page < 5; page += 1) {
    const qs = new URLSearchParams({ path: dir });
    if (cursor) qs.set('cursor', cursor);
    const res = await fetch(`${base(worker)}/tree?${qs.toString()}`, { cache: 'no-store' });
    if (!res.ok) throw await httpError(res, `tree ${dir}`);
    const body = await jsonBody<TreeResponse>(res, `tree ${dir}`);
    out.push(...(body.entries ?? []));
    if (!body.has_more || !body.next_cursor) break;
    cursor = body.next_cursor;
  }
  return out;
}

export async function fetchFullContent(worker: string, path: string, cap = MAX_CHUNKS): Promise<string> {
  let offset = 0;
  let out = '';
  for (let i = 0; i < cap; i += 1) {
    const qs = new URLSearchParams({ path, offset: String(offset), limit: String(CHUNK) });
    const res = await fetch(`${base(worker)}/file-content?${qs.toString()}`, { cache: 'no-store' });
    if (!res.ok) throw await httpError(res, `file-content ${path}`);
    const body = await jsonBody<FileContentResponse>(res, `file-content ${path}`);
    out += body.content ?? '';
    if (body.eof) return out;
    offset = body.next_offset;
    if (!Number.isFinite(offset) || offset <= 0) return out;
  }
  return out;
}

/** 收集 KB 内全部 md 文件（顶层档案 md + memory/** + digest/**，深度≤4） */
async function collectMdFiles(worker: string): Promise<string[]> {
  const top = await fetchTree(worker, ''); // 顶层失败=致命（工作区不可达）
  const files: string[] = top
    .filter((e) => e.kind === 'file' && e.name.toLowerCase().endsWith('.md'))
    .map((e) => e.path);
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 4) return;
    let entries: TreeEntry[];
    try {
      entries = await fetchTree(worker, dir);
    } catch {
      return; // 单目录失败不拖垮全量
    }
    for (const e of entries) {
      if (e.kind === 'directory') await walk(e.path, depth + 1);
      else if (e.name.toLowerCase().endsWith('.md')) files.push(e.path);
    }
  };
  await Promise.all([walk('memory', 1), walk('digest', 1)]);
  // 去重（顶层档案与子树不重叠，此处仅防重复）
  return Array.from(new Set(files));
}

/** 单 Worker 建图（单 Agent 模式与聚合模式每 Worker 共用）：
 *  抓取 ≤cap 个 md（MEMORY.md 若在优先入图）→ assembleGraph。 */
export async function buildAgentGraph(worker: string, cap: number): Promise<{ nodes: Omit<GNode, 'agent'>[]; edges: GEdge[] }> {
  const files = await collectMdFiles(worker);
  // MEMORY.md 若在（KB 布局根文件）优先入图
  const hasMemory = files.includes('MEMORY.md');
  const targets = files.filter((f) => f !== 'MEMORY.md').slice(0, cap - 1);
  const all = hasMemory ? ['MEMORY.md', ...targets] : files.slice(0, cap);
  const contents: (string | null)[] = new Array(all.length).fill(null);
  let idx = 0;
  const concurrency = 6;
  const workerPool = async () => {
    while (idx < all.length) {
      const i = idx;
      idx += 1;
      try {
        contents[i] = await fetchFullContent(worker, all[i]);
      } catch {
        contents[i] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, all.length)) }, () => workerPool()));
  return assembleGraph(all, contents);
}
