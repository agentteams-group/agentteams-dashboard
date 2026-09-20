import { NextRequest, NextResponse } from 'next/server';
import { getAuthToken, getControllerUrl } from '../../../../proxy-helper';
import { isValidNameSegment } from '@/lib/skill-package';
import { isSensitiveFileName } from '@/lib/sensitive-files';
import { enforceServerSideRbac } from '@/lib/server-auth';

// 知识库 v2（workbench 插件同款数据面：Controller Docker 代理只读）。
// 9/16 装验定案：「知识库照插件做」——插件 KB 不依赖 #1208 端点，走
// Controller Docker 代理 tarball，旧 Controller 即开即用；dashboard 换同款
// 数据面后 404 横幅场景消失（#1208 端点 dashboard 不再消费，上游保留不影响）。
//
// 数据面（workbench connector/router.py _kb_docker/_kb_workspace 移植）：
//   GET/HEAD {controller}/docker/v1.41/containers/{agentteams-worker-<name>}/archive?path=...
//   Bearer=AGENTTEAMS_AUTH_TOKEN（getAuthToken：env/token-file，随投影 SA 轮换重读）
//   Controller Docker 代理 GET/HEAD 恒放行（插件实测）；单 tar 上限 20MB（daemon 限制）
//   工作区探测：候选路径 HEAD archive 并行探测（qwenpaw→copaw→顶层），30min 缓存
//   （容器挂载决定路径、实际不变；插件同款 5min→30min 调优）
//   敏感文件：lib/sensitive-files（与插件 _kb_is_sensitive / 文件面板同定义）
//
// KB 布局（插件四分类，dashboard 范围=workers，manager 有独立 console 入口）：
//   档案=顶层 md 文件 / 文件=其余顶层条目（只列不展开）/ 日记=memory/** / 知识库=digest/**
//   展开（tree?path=）仅允许 memory/** 与 digest/**（其余顶层目录禁展开——插件同款）。
//
// 契约（前端无感，面板形状不变）：
//   tree          → { directory, entries:[{kind,name,path,size,modified_at,preview_kind}], has_more, next_cursor }
//   file-metadata → { etag, modified_at, path, preview_kind, size }
//   file-content  → { content, encoding, eof, etag, limit, next_offset, offset }（单块 ≤1MB，eof 恒 true）

const SUB_WHITELIST: ReadonlySet<string> = new Set(['tree', 'file-metadata', 'file-content']);

const DOCKER_API_VERSION = 'v1.41';
const MAX_TAR_BYTES = 20 * 1024 * 1024; // daemon archive 上限（插件实测 20MB）
const MAX_FILE_BYTES = 1024 * 1024; // 单文件预览上限
const WS_CACHE_TTL_MS = 30 * 60 * 1000;

interface TarEntry {
  name: string;
  size: number;
  mtime: number;
  isdir: boolean;
}

// 工作区路径探测缓存（模块级；单实例 dashboard，投影 token 轮换与路径无关）。
const wsCache = new Map<string, { ws: string; ts: number }>();

interface TarMember {
  name: string;
  size: number;
  mtime: number;
  typeflag: string; // '0' 文件 / '5' 目录 / 'x'·'g' pax 扩展 / 其他
  dataStart: number; // 数据区起点（文件=off+512）
}

/**
 * 最小 ustar 顺序解析（Docker archive 产物；pax 扩展头 'x'/'g' 跳过不产出条目）。
 * Docker archive 条目语义（9/16 真机实测 + 插件 _kb_tar_entries 同款）：
 *   目录请求 = 所请求路径的 basename 根前缀（'default/AGENTS.md'）+ 根成员自身；
 *   文件请求 = 裸文件名成员。消费方（listDir）按 uniform 检测剥离根前缀。
 */
function tarMembers(buf: Buffer): TarMember[] {
  const out: TarMember[] = [];
  for (let off = 0; off + 512 <= buf.length; ) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break; // 终止零块
    const rawName = h.subarray(0, 100).toString('utf8').split('\0')[0];
    const prefix = h.subarray(345, 500).toString('utf8').split('\0')[0];
    const sizeStr = h.subarray(124, 136).toString('utf8').replace(/\0/g, '').trim();
    const mtimeStr = h.subarray(136, 148).toString('utf8').replace(/\0/g, '').trim();
    const size = parseInt(sizeStr || '0', 8);
    const mtime = parseInt(mtimeStr || '0', 8); // tar mtime 字段=八进制
    const typeflag = String.fromCharCode(h[156] || 0);
    const name = prefix ? `${prefix}/${rawName}` : rawName;
    if (name && typeflag !== 'x' && typeflag !== 'g') {
      out.push({
        name,
        size: Number.isFinite(size) ? size : 0,
        mtime: Number.isFinite(mtime) ? mtime : 0,
        typeflag,
        dataStart: off + 512,
      });
    }
    off += 512 + Math.ceil((Number.isFinite(size) ? size : 0) / 512) * 512;
  }
  return out;
}

function previewKindOf(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'txt' || ext === 'log') return 'text';
  return 'binary';
}

const iso = (sec: number) => (sec > 0 ? new Date(sec * 1000).toISOString() : '');

async function dockerProxy(
  controllerUrl: string,
  token: string | undefined,
  path: string,
  head: boolean,
  timeoutMs = 40_000,
): Promise<{ status: number; body: Buffer }> {
  const url = `${controllerUrl.replace(/\/$/, '')}/docker/${DOCKER_API_VERSION}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: head ? 'HEAD' : 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw Object.assign(
      new Error(`Docker 代理请求失败：${err instanceof Error ? err.message : String(err)}`),
      { status: 502 },
    );
  }
  const body = head ? Buffer.alloc(0) : Buffer.from(await res.arrayBuffer());
  return { status: res.status, body };
}

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** 工作区路径探测（插件 _kb_workspace 移植：inspect→候选并行 HEAD，30min 缓存）。 */
async function resolveWorkspace(
  controllerUrl: string,
  token: string | undefined,
  name: string,
): Promise<string> {
  const now = Date.now();
  const hit = wsCache.get(name);
  if (hit && now - hit.ts < WS_CACHE_TTL_MS) return hit.ws;

  const container = `agentteams-worker-${name}`;
  const stInspect = await dockerProxy(controllerUrl, token, `/containers/${container}/json`, false, 15_000);
  if (stInspect.status === 404) {
    throw Object.assign(new Error(`容器 ${container} 不存在`), { status: 404 });
  }
  if (stInspect.status !== 200) {
    throw Object.assign(new Error(`容器探测失败（Docker API ${stInspect.status}）`), { status: 502 });
  }

  const home = `/root/agentteams-fs/agents/${name}`;
  const candidates = [
    `${home}/.qwenpaw/workspaces/default`,
    `${home}/.copaw/workspaces/default`,
    home,
  ];
  const results = await Promise.all(
    candidates.map((cand) =>
      dockerProxy(controllerUrl, token, `/containers/${container}/archive?path=${encodeURIComponent(cand)}`, true, 40_000)
        .then((r) => r.status)
        .catch(() => 0),
    ),
  );
  for (let i = 0; i < candidates.length; i += 1) {
    if (results[i] === 200 || results[i] === 304) {
      wsCache.set(name, { ws: candidates[i], ts: now });
      return candidates[i];
    }
  }
  wsCache.delete(name);
  throw Object.assign(new Error(`未找到工作区目录（容器 ${container} 可能仍在启动中）`), { status: 404 });
}

/**
 * 取 {ws}{dir} 的直接子级条目。
 * Docker archive 语义（9/16 真机实测，插件 _kb_tar_entries 同款处理）：
 *   · 目录请求：tar 根 = 所请求路径的 basename（如 'default/AGENTS.md'），
 *     首个成员 = 所请求目录自身；顶层段一致（uniform）时剥离根前缀。
 *   · 文件请求：成员 = 裸文件名（如 '2026-09-04.md'）。
 *   · 个别 daemon 版本可能直接返回相对名（无根前缀）——按插件同款 uniform
 *     检测兼容两种形态。
 */
async function listDir(
  controllerUrl: string,
  token: string | undefined,
  container: string,
  ws: string,
  dir: string,
): Promise<{ status: number; error?: string; entries?: TarEntry[] }> {
  const target = dir ? `${ws}/${dir}` : ws;
  const r = await dockerProxy(
    controllerUrl,
    token,
    `/containers/${container}/archive?path=${encodeURIComponent(target)}`,
    false,
  );
  if (r.status === 404) return { status: 404, error: `路径不存在：${dir || '(工作区根)'}` };
  if (r.status !== 200 && r.status !== 304) {
    return { status: 502, error: `工作区列取失败（Docker API ${r.status}）` };
  }
  if (r.body.length > MAX_TAR_BYTES) {
    return { status: 502, error: '工作区体积超出 20MB tar 上限，无法列取（大工作区可后续走 exec 兜底）' };
  }
  // 拆段（跳空段与 '.'，对齐插件 parts 语义）
  const all = tarMembers(r.body)
    .map((m) => ({
      parts: m.name.split('/').filter((p) => p && p !== '.'),
      isdir: m.typeflag === '5',
      size: m.size,
      mtime: m.mtime,
    }))
    .filter((e) => e.parts.length > 0);
  const tops = new Set(all.map((e) => e.parts[0]));
  const uniform = tops.size === 1; // 目录请求（根前缀一致）→ 剥离首段
  const entries: TarEntry[] = [];
  for (const e of all) {
    const relParts = uniform ? e.parts.slice(1) : e.parts;
    if (relParts.length === 0) continue; // 所请求目录自身（根成员）——跳过
    const rel = relParts.join('/');
    if (rel.includes('/')) continue; // 只取直接子级（懒展开：子目录点开时再列）
    entries.push({ name: rel, size: e.size, mtime: e.mtime, isdir: e.isdir });
  }
  // 码元序（非 localeCompare——locale 相关排序跨环境不确定，测试与 UI 均期望稳定序）
  entries.sort((a, b) => (a.isdir === b.isdir ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.isdir ? -1 : 1));
  return { status: 200, entries };
}

/** 测试钩子：清工作区探测缓存（30min TTL 会跨用例残留）。 */
export function __resetKbCacheForTests(): void {
  wsCache.clear();
}

/** path 合法性：顶层单文件 或 memory/** / digest/**（展开/读取同域；禁 '..'）。 */
function validateKbPath(path: string): string | null {
  if (!path || path.includes('..') || path.startsWith('/')) return '非法路径';
  const top = path.split('/')[0];
  if (path.includes('/')) {
    if (top !== 'memory' && top !== 'digest') return '仅 memory/** 与 digest/** 支持展开/读取';
    return null;
  }
  return null; // 顶层单文件（档案/文件分类）
}

function tooLarge(err: unknown): boolean {
  return err instanceof Error && /20MB|上限/.test(err.message);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; sub: string }> },
) {
  const { name, sub } = await params;
  if (!isValidNameSegment(name)) {
    return jsonError('非法 Worker 名', 400);
  }
  if (!SUB_WHITELIST.has(sub)) {
    return jsonError(`不支持的子路径：${sub}`, 400);
  }
  // Defense-in-depth second gate (main #117 keeps this on the v2 data plane
  // too): records an audit trail and enforces the dashboard level matrix;
  // the middleware remains the authority.
  const denied = await enforceServerSideRbac(request, 'view', 'worker', name);
  if (denied) return denied;
  const controllerUrl = getControllerUrl(request);
  const token = await getAuthToken();
  const container = `agentteams-worker-${name}`;
  const qs = request.nextUrl.searchParams;

  try {
    const ws = await resolveWorkspace(controllerUrl, token, name);

    if (sub === 'tree') {
      const dir = (qs.get('path') ?? '').replace(/^\/+|\/+$/g, '');
      // 展开白名单：仅 memory/**·digest/**（顶层目录如 credentials/ 禁展开——插件同款）
      const dirOk = dir === '' || dir === 'memory' || dir === 'digest'
        || dir.startsWith('memory/') || dir.startsWith('digest/');
      if (!dirOk) {
        return jsonError('仅 memory/** 与 digest/** 支持展开', 400);
      }
      const r = await listDir(controllerUrl, token, container, ws, dir);
      if (r.status !== 200 || !r.entries) return jsonError(r.error ?? '列取失败', r.status);
      const entries = r.entries
        .filter((e) => !isSensitiveFileName(e.name, dir ? `${dir}/${e.name}` : e.name))
        .map((e) => ({
          kind: e.isdir ? 'directory' : 'file',
          name: e.name,
          path: dir ? `${dir}/${e.name}` : e.name,
          size: e.isdir ? null : e.size,
          modified_at: iso(e.mtime),
          preview_kind: e.isdir ? '' : previewKindOf(e.name),
        }));
      return NextResponse.json({
        directory: dir || 'workspace',
        entries,
        has_more: false,
        next_cursor: null,
      });
    }

    const path = qs.get('path') ?? '';
    if (sub === 'file-metadata' || sub === 'file-content') {
      const bad = validateKbPath(path);
      if (bad) return jsonError(bad, 400);
      if (isSensitiveFileName(path.split('/').pop() ?? path, path)) {
        return jsonError('敏感文件不可读取', 400);
      }
      const target = `${ws}/${path}`;
      const r = await dockerProxy(
        controllerUrl,
        token,
        `/containers/${container}/archive?path=${encodeURIComponent(target)}`,
        false,
      );
      if (r.status === 404) return jsonError(`文件不存在：${path}`, 404);
      if (r.status !== 200 && r.status !== 304) {
        return jsonError(`文件读取失败（Docker API ${r.status}）`, 502);
      }
      const file = tarMembers(r.body).find((m) => m.typeflag === '0' || m.typeflag === '');
      if (!file) return jsonError(`文件不存在：${path}`, 404);
      if (file.size > MAX_FILE_BYTES) {
        return jsonError(`文件超出 1MB 预览上限（${(file.size / 1024 / 1024).toFixed(1)}MB）`, 502);
      }
      if (sub === 'file-metadata') {
        return NextResponse.json({
          etag: '',
          modified_at: iso(file.mtime),
          path,
          preview_kind: previewKindOf(file.name),
          size: file.size,
        });
      }
      // file-content：?raw=1 → 原始字节直下（对齐插件文件下载）；
      // 缺省 → JSON 单块返回（≤1MB，面板分块循环首块即 eof）
      const rawBytes = r.body.subarray(file.dataStart, file.dataStart + file.size);
      if (qs.get('raw') === '1') {
        const safeName = (path.split('/').pop() ?? 'download').replace(/[^\w.\-一-龥]/g, '_');
        return new NextResponse(new Uint8Array(rawBytes), {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(safeName)}"`,
            'Cache-Control': 'no-store',
          },
        });
      }
      const content = rawBytes.toString('utf8');
      return NextResponse.json({
        content,
        encoding: 'utf8',
        eof: true,
        etag: '',
        limit: 0,
        next_offset: 0,
        offset: 0,
      });
    }
    return jsonError(`不支持的子路径：${sub}`, 400);
  } catch (err) {
    const status = (err as { status?: number })?.status ?? (tooLarge(err) ? 502 : 500);
    const message = err instanceof Error ? err.message : '知识库读取失败';
    if (process.env.NODE_ENV !== 'test') {
      console.error(`[kb] ${name} ${sub}: ${message}`);
    }
    return jsonError(message, status);
  }
}
