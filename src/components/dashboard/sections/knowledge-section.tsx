'use client';

// 知识库 v3（9/17 装验定案「照插件做」三件：预览与图谱分离 /
// 团队聚合图谱 + v4 2D 簇块布局——workbench 插件 KnowledgeBase.tsx 同款结构）。
//   · 数据面（v2 不变）：/api/agentteams/workers/[name]/workspace-files/{tree|file-metadata|file-content}
//     后端=Controller Docker 代理 tarball 只读（route.ts 内注释）——
//     404=真实故障（容器/工作区缺失），直接显示服务端错误。
//   · 布局（插件同构）：左=KB 文件树（四分类）；右=**图谱卡常驻** +
//     **预览卡独立下置**——点节点/文件只更新预览卡，图谱永不消失
//     （修「点开预览再点回退退到空白」：单格视图互斥 → 双视图并存）。
//   · 图谱：2D 簇块布局（v4；3D 引擎按评审拆为 follow-up，不进本批次）。
//   · 团队聚合图谱（插件 fetchKbGraphMerged 的客户端等价物——dashboard
//     无插件同款服务端合并端点，改客户端按团队拉各 Worker md 合并建图）：
//     节点按 Worker 着色（AGENT_PALETTE 插件同值）、id=`worker::path`、
//     边保留各 Worker 内部；点聚合节点开**目标 Worker** 文件，不切换
//     当前 Worker（插件 agentOverride 同语义）。
//   · 选择记忆（插件 kbState 同款）：worker / graphMode / team
//     localStorage 持久化，失效值回退默认。
//   · 预览：file-content 分块读（offset/eof 循环；v2 后端单块 ≤1MB 即 eof）

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Download,
  FileText,
  FolderOpen,
  Folder,
  Loader2,
  Network,
  RefreshCw,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SectionHeader } from '@/components/dashboard/section-header';
import { MarkdownMessage } from '@/components/dashboard/sections/chat/markdown-message';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import type { WorkerResponse } from '@/lib/agentteams-api';

// ── 类型（#1208 D2 / QwenPaw workspace_files.py 实锤形状）──────────────────
interface TreeEntry {
  kind: 'file' | 'directory';
  name: string;
  path: string;
  size: number | null;
  modified_at: string;
  preview_kind: string;
}
interface TreeResponse {
  directory: string;
  entries: TreeEntry[];
  has_more: boolean;
  next_cursor: string | null;
}
interface FileContentResponse {
  content: string;
  eof: boolean;
  offset: number;
  next_offset: number;
  etag: string;
}

// v3：节点 id=**文件路径**（干名只做 wikilink 匹配键——同干不同目录
// 两文件不再被合并成一个节点；插件单 Agent 图 id=path 同款）。
export interface GNode {
  id: string;
  path: string;
  label: string;
  deg: number;
  isMemory: boolean;
  /** 聚合模式：节点所属 Worker（着色/跳转用）。 */
  agent?: string;
  /** v4：虚拟分类根（digest/wiki|personal|procedure——插件 virtual:* 同款）。 */
  virtual?: boolean;
  /** v4：未解析 wikilink 灰点（文件不存在，不可点开——插件 resolved:false 同款）。 */
  resolved?: boolean;
}
interface GEdge { s: number; t: number }
interface GraphData {
  nodes: GNode[];
  edges: GEdge[];
  pos: Map<string, { x: number; y: number }>;
  /** 节点 id → chip 尺寸（v4 矩形 chip）。 */
  size: Map<string, { w: number; h: number }>;
  /** 簇块包围盒（v4 虚线框 + 聚焦视野）。 */
  blocks: ClusterBlock[];
  view: RadialView;
  /** 节点 id → 簇 hub id（2D 聚焦/簇淡出归属）。 */
  sectorOf: Map<string, string>;
  /** 簇 hub id 列表（2D 聚焦目标 + 虚线框顺序）。 */
  hubs: string[];
}

// 聚合节点图例配色（插件 AGENT_PALETTE 同值）。
const AGENT_PALETTE = [
  '#FF7F16', '#1677ff', '#52c41a', '#f5222d', '#722ed1',
  '#fa8c16', '#13c2c2', '#eb2f96',
];

// 选择记忆键（插件 kbState 同款语义：存值、失效回退默认）。
const KB_MEM = 'agentteams:kb:';
function readMem(key: string): string {
  try { return window.localStorage.getItem(KB_MEM + key) ?? ''; } catch { return ''; }
}
function writeMem(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(KB_MEM + key, value);
    else window.localStorage.removeItem(KB_MEM + key);
  } catch { /* 存储不可用（隐私模式）=不记忆，不报错 */ }
}

const base = (w: string) => `/api/agentteams/workers/${encodeURIComponent(w)}/workspace-files`;
const MAX_GRAPH_FILES = 150; // 单 Worker 图谱内容抓取上限（对齐插件 _KB_MAX_GRAPH_FILES=150）
const MAX_MERGED_FILES = 240; // 聚合模式全量上限（跨 Worker 总预算）
const CHUNK = 200_000; // file-content 单块
const MAX_CHUNKS = 8; // 单文件最多 1.6MB

// ── 数据获取 ───────────────────────────────────────────────────────────────
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

async function fetchTree(worker: string, dir: string): Promise<TreeEntry[]> {
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

async function fetchFullContent(worker: string, path: string, cap = MAX_CHUNKS): Promise<string> {
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

/** wikilink [[title]] / [[title|alias]] / [[title#anchor]] → title */
function extractWikilinks(md: string): string[] {
  const out: string[] = [];
  const re = /\[\[([^\]|\[\n]+?)(?:#[^\]|\[\n]*)?(?:\|[^\]\n]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const t = m[1].trim();
    if (t) out.push(t);
  }
  return out;
}

const basename = (p: string) => p.split('/').pop() ?? p;
const stem = (p: string) => (basename(p).toLowerCase().endsWith('.md') ? basename(p).slice(0, -3) : basename(p));

/** digest 三虚拟分桶（插件 kb_graph 同款：wiki/personal/procedure）。 */
const DIGEST_BUCKETS = ['wiki', 'personal', 'procedure'] as const;

/** v4 图谱模型（对齐插件 kb_graph / QwenPaw ReMe graph_snapshot_step）：
 *  节点 = md 文件 + 虚拟分类根（digest/{bucket} 非空才生成）
 *       + 未解析引用灰点（wikilink 指向不存在的文件，不可点开）；
 *  边   = 结构边（分类根→分桶文件，任意深度）
 *       + 兜底 hub（无 digest 分桶时 MEMORY.md→depth-1 memory 文件）
 *       + [[wikilink]]（含 |alias / #anchor）
 *       + →/← 路径块引用（ReMe inlinks/outlinks 行约定）。
 *  纯函数（paths+contents → 图），单测直接打，不 mock fetch。 */
export function assembleGraph(
  paths: string[],
  contents: (string | null)[],
): { nodes: Omit<GNode, 'agent'>[]; edges: GEdge[] } {
  const nodes: Omit<GNode, 'agent'>[] = paths.map((p) => ({
    id: p,
    path: p,
    label: stem(p),
    deg: 0,
    isMemory: p === 'MEMORY.md',
  }));
  // 虚拟分类根——非空才生成（避免空根节点污染前端，插件同款）。
  for (const b of DIGEST_BUCKETS) {
    if (paths.some((p) => p.startsWith(`digest/${b}/`))) {
      nodes.push({
        id: `virtual:${b}`, path: `virtual:${b}`, label: b,
        deg: 0, isMemory: false, virtual: true,
      });
    }
  }
  // 归一索引：target（完整路径 / 文件名，可缺 .md）→ 文件路径。
  // 插件 norm_map 同构（path + path 去 .md + tail + tail 去 .md 四键），
  // 键额外小写化：[[MEMORY]] 须匹配 'MEMORY.md'（集群 KB 大写约定）。
  const normMap = new Map<string, string>();
  for (const p of paths) {
    const add = (k: string) => {
      const kk = k.toLowerCase();
      if (!normMap.has(kk)) normMap.set(kk, p); // 同干多文件=首个（与 v2/v3 一致）
    };
    add(p);
    if (p.toLowerCase().endsWith('.md')) add(p.slice(0, -3));
    const tail = p.split('/').pop() ?? p;
    add(tail);
    if (tail.toLowerCase().endsWith('.md')) add(tail.slice(0, -3));
  }
  const indexById = new Map<string, number>();
  nodes.forEach((n, i) => indexById.set(n.id, i));
  const resolveTarget = (raw: string): string | null => {
    const t = raw.trim().replace(/^['"`]+|['"`]+$/g, '').trim();
    if (!t || t.startsWith('http') || t.startsWith('/')) return null;
    const cands = [t];
    const rs = t.replace(/\/+$/, '');
    if (rs !== t) cands.push(rs);
    cands.push(t.endsWith('.md') ? t.slice(0, -3) : `${t}.md`);
    for (const c of cands) {
      const hit = normMap.get(c.toLowerCase());
      if (hit) return hit;
    }
    return null;
  };
  const ensureUnresolved = (t: string): number => {
    let i = indexById.get(t);
    if (i == null) {
      i = nodes.length;
      nodes.push({
        id: t, path: t, label: t.split('/').pop() ?? t,
        deg: 0, isMemory: false, resolved: false,
      });
      indexById.set(t, i);
    }
    return i;
  };
  const edges: GEdge[] = [];
  const seen = new Set<string>();
  const addEdge = (sPath: string, tRaw: string): void => {
    const t = tRaw.trim().replace(/^['"`]+|['"`]+$/g, '').trim();
    if (!t || t.startsWith('http') || t.startsWith('/')) return; // 外部/绝对路径不成边（插件同款）
    const sIdx = indexById.get(sPath);
    if (sIdx == null) return;
    const resolved = resolveTarget(t);
    const tIdx = resolved != null ? indexById.get(resolved) : ensureUnresolved(t);
    if (tIdx == null || tIdx === sIdx) return; // 自链跳过
    const key = `${sIdx}->${tIdx}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ s: sIdx, t: tIdx });
    nodes[sIdx].deg += 1;
    nodes[tIdx].deg += 1;
  };
  // 结构边：分类根 → digest/{bucket}/ 文件（任意深度）。
  for (const p of paths) {
    if (p.startsWith('digest/') && p.split('/').length >= 3) {
      const first = p.split('/')[1];
      if ((DIGEST_BUCKETS as readonly string[]).includes(first)) {
        addEdge(`virtual:${first}`, p);
      }
    }
  }
  // 兜底 hub：无 digest 分桶 + MEMORY.md 在 → MEMORY.md 挂 depth-1 memory 文件
  // （旧布局 worker 保证图不空，插件同款）。
  const hasBucket = DIGEST_BUCKETS.some((b) =>
    paths.some((p) => p.startsWith(`digest/${b}/`)),
  );
  if (!hasBucket && paths.includes('MEMORY.md')) {
    for (const p of paths) {
      if (p.startsWith('memory/') && p.split('/').length === 2) {
        addEdge('MEMORY.md', p);
      }
    }
  }
  // 语义边：[[wikilink]] + →/← 路径块引用（ReMe inlinks/outlinks 行约定）。
  paths.forEach((p, i) => {
    const text = contents[i];
    if (!text) return;
    for (const t of extractWikilinks(text)) addEdge(p, t);
    const rePath = /^[ \t]*(?:→|←)\s+(\S+?)(?:[ \t]+name=|[ \t]*$)/gm;
    let m: RegExpExecArray | null;
    while ((m = rePath.exec(text)) !== null) addEdge(p, m[1]);
  });
  return { nodes, edges };
}

/** 单 Worker 建图（单 Agent 模式与聚合模式每 Worker 共用）：
 *  抓取 ≤cap 个 md（MEMORY.md 若在优先入图）→ assembleGraph。 */
async function buildAgentGraph(worker: string, cap: number): Promise<{ nodes: Omit<GNode, 'agent'>[]; edges: GEdge[] }> {
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

// ── 2D 簇矩形布局（v4，第 12 轮；替代 v2/v3 分层径向；插件 KnowledgeBase 同算法同值）──
// 径向的结构性问题（装验反馈 9/18「很乱、不够直观、看不清楚」）：
//   ① 环上按弧长排节点 → 标签沿弧旋转挤压，簇一多就糊成一团；
//   ② 深度环 + 过密外溢同心环 → 同一分类的文件散在不同半径上，看不出从属；
//   ③ 跨簇边全是节点级曲线 → 毛球。
// v4 = 簇矩形块（block）：
//   每簇一块（hub 横幅置顶 + 成员网格），块间大留白（BLOCK_GAP_*）；
//   标签水平直排、永不重叠（网格保证）；跨簇边收敛为「块-块」单线
//   （hub 中心到 hub 中心，簇对去重）——毛球消失；
//   簇轮廓虚线框 = 簇分离视觉锚（替代 v3 扇区边界弧）。
// 纯函数、无 Math.random——确定性布局可单测复现（与 v2/v3 同款纪律）。
export interface RadialView { minX: number; minY: number; width: number; height: number }

/** 簇块包围盒（渲染虚线框 + 聚焦视野）。 */
export interface ClusterBlock { hubId: string; minX: number; minY: number; w: number; h: number }

// 几何常量（双端同值——插件镜像时逐字对齐，勿单端调参）。
export const KB2D = {
  CHIP_H: 26,        // 成员节点 chip 高
  HUB_H: 34,         // hub（簇横幅）chip 高
  CHIP_PAD_X: 12,    // chip 左右内边距（各）
  FONT_W: 6.2,       // 11px 字体拉丁平均字宽
  FONT_W_CJK: 11,    // 11px 字体 CJK 全角字宽（= 字号，1:1；12.12 与插件同款）
  MIN_W: 44,
  MAX_W: 180,
  GAP_X: 16,         // 簇内网格列距
  GAP_Y: 14,         // 簇内网格行距
  HUB_GAP_Y: 12,     // hub 与成员网格间距
  BLOCK_GAP_X: 88,   // 簇块间横向留白（「分开簇」）
  BLOCK_GAP_Y: 72,   // 簇块间纵向留白
  ROW_MAX_W: 1560,   // 块流式换行阈值
  PAD: 64,           // 视野留白
} as const;

/** 缩放钳制：zoom = fit.width / vb.width 必须落在 [minZoom, maxZoom]，
 * 越界时以当前视野中心为锚回缩。平移不限（自由拖，复位按钮兜底）。 */
export function clampZoomView(
  vb: RadialView,
  fit: RadialView,
  minZoom = 0.25,
  maxZoom = 8,
): RadialView {
  const zoom = fit.width / vb.width;
  if (zoom >= minZoom && zoom <= maxZoom) return vb;
  const target = zoom < minZoom ? minZoom : maxZoom;
  const width = fit.width / target;
  const cx = vb.minX + vb.width / 2;
  const cy = vb.minY + vb.height / 2;
  return { minX: cx - width / 2, minY: cy - (vb.height * (width / vb.width)) / 2, width, height: vb.height * (width / vb.width) };
}

/** 聚焦目标：簇（块）或单节点邻域。 */
export type FocusTarget = { kind: 'sector'; hubId: string } | { kind: 'node'; id: string };

/** 一组点的包围盒 + 留白（聚焦视野）。空集 → null。 */
export function focusView(points: Array<{ x: number; y: number }>, pad = 70): RadialView | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX: minX - pad, minY: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}

/** CJK 加权文本像素宽（11px 字体：CJK/全角 ≈ 字号，拉丁 ≈ FONT_W）。
 *  12.12：原 label.length * FONT_W 对中文名低估 ~44%，圆角 chip 内文字外溢压盖
 *  （「簇重叠」双端复报根因之一）；chipWidth 与标签截断共用同一估宽。
 *  与插件 KnowledgeBase.textWidthUnits 同款同值。 */
export function textWidthUnits(label: string): number {
  let units = 0;
  for (const ch of label) {
    units += /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/.test(ch)
      ? KB2D.FONT_W_CJK
      : KB2D.FONT_W;
  }
  return units;
}

/** chip 宽：按 label 估宽，钳制 [MIN_W, MAX_W]。 */
export function chipWidth(label: string, h: number = KB2D.CHIP_H): number {
  void h; // 宽度与高度无关，签名保留便于双端对齐
  const w = textWidthUnits(label) + KB2D.CHIP_PAD_X * 2;
  return Math.min(KB2D.MAX_W, Math.max(KB2D.MIN_W, Math.round(w)));
}

export interface ClusterLayout {
  /** 节点 id → chip 中心。 */
  pos: Map<string, { x: number; y: number }>;
  /** 节点 id → chip 尺寸（渲染 rect）。 */
  size: Map<string, { w: number; h: number }>;
  /** 节点 id → 所属簇 hub 的节点 id。 */
  sectorOf: Map<string, string>;
  /** 簇 hub 的节点 id 列表（顺序=簇顺序）。 */
  hubs: string[];
  /** 簇块包围盒（虚线框 + 聚焦）。 */
  blocks: ClusterBlock[];
  /** 自适应视野。 */
  view: RadialView;
}

export function clusterGridLayout(
  nodes: GNode[],
  edgePairs: Array<[string, string]>,
  agentOrder?: string[],
): ClusterLayout {
  const n = nodes.length;
  const empty: ClusterLayout = {
    pos: new Map(),
    size: new Map(),
    sectorOf: new Map(),
    hubs: [],
    blocks: [],
    view: { minX: -380, minY: -210, width: 760, height: 420 },
  };
  if (n === 0) return empty;
  const idxOf = new Map<string, number>(nodes.map((nd, i) => [nd.id, i]));
  const adj: number[][] = Array.from({ length: n }, () => []);
  const deg = new Array<number>(n).fill(0);
  for (const [a, b] of edgePairs) {
    const i = idxOf.get(a);
    const j = idxOf.get(b);
    if (i == null || j == null || i === j) continue;
    adj[i].push(j); adj[j].push(i); deg[i] += 1; deg[j] += 1;
  }
  // 1) 簇 = 连通分量（v4 语义：一块=一个连通簇）。
  //    聚合模式例外：簇按 agent 字段划分（Worker 块），不被跨 Worker 链接切碎。
  const degRank = (x: number, y: number) =>
    // 降序：最高度数优先（hub=簇内最连接文件）。v3 的 deg[x]-deg[y] 是升序，
    // hub 会取到最低度叶子——R12 插件冒烟 T1 抓出，双端同修。
    deg[y] - deg[x] || nodes[x].label.localeCompare(nodes[y].label) || x - y;
  const sectorIdx = new Array<number>(n).fill(-1);
  const sectors: { hub: number }[] = [];
  if (agentOrder && agentOrder.length > 0) {
    agentOrder.forEach((agent, si) => {
      const members: number[] = [];
      nodes.forEach((nd, i) => { if (nd.agent === agent) members.push(i); });
      if (members.length === 0) return;
      let hub = -1;
      for (const i of members) if (nd_virtual(nodes[i])) { hub = i; break; }
      if (hub < 0) { members.sort(degRank); hub = members[0]; }
      sectors.push({ hub });
      nodes.forEach((nd, i) => { if (nd.agent === agent) sectorIdx[i] = si; });
    });
  } else {
    // 连通分量（按最小节点序确定顺序）→ 每分量一个簇：
    // hub = 分量内 virtual 根（首个）；无 virtual → 分量内最高度数节点。
    const comp = new Array<number>(n).fill(-1);
    let ci = 0;
    for (let s = 0; s < n; s += 1) {
      if (comp[s] !== -1) continue;
      const queue = [s];
      comp[s] = ci;
      let head = 0;
      while (head < queue.length) {
        const u = queue[head];
        head += 1;
        for (const v of adj[u]) if (comp[v] === -1) { comp[v] = ci; queue.push(v); }
      }
      ci += 1;
    }
    for (let c = 0; c < ci; c += 1) {
      const members: number[] = [];
      for (let i = 0; i < n; i += 1) if (comp[i] === c) members.push(i);
      let hub = -1;
      for (const i of members) if (nd_virtual(nodes[i])) { hub = i; break; }
      if (hub < 0) { members.sort(degRank); hub = members[0]; }
      sectors.push({ hub });
      members.forEach((i) => { sectorIdx[i] = sectors.length - 1; });
    }
  }
  if (sectors.length === 0) sectors.push({ hub: 0 });
  // 未归属节点（agent 不在列表/陈旧数据）→ 挂末簇，不丢点。
  nodes.forEach((_, i) => { if (sectorIdx[i] === -1) sectorIdx[i] = sectors.length - 1; });
  const depth = new Array<number>(n).fill(-1);
  {
    const queue: number[] = [];
    sectors.forEach((s) => { depth[s.hub] = 0; queue.push(s.hub); });
    let head = 0;
    while (head < queue.length) {
      const u = queue[head];
      head += 1;
      for (const v of adj[u]) {
        if (depth[v] === -1) { depth[v] = depth[u] + 1; queue.push(v); }
      }
    }
    for (let i = 0; i < n; i += 1) if (depth[i] === -1) depth[i] = 1;
  }
  // 2) 逐簇排块：hub 横幅置顶 + 成员网格（depth 升序 → label 升序，确定性）。
  const pos = new Map<string, { x: number; y: number }>();
  const size = new Map<string, { w: number; h: number }>();
  const sectorOf = new Map<string, string>();
  interface PlacedBlock { hub: number; members: number[]; w: number; h: number; hubW: number }
  const placed: PlacedBlock[] = sectors.map((s) => {
    const members: number[] = [];
    for (let i = 0; i < n; i += 1) {
      if (sectorIdx[i] === sectors.indexOf(s) && i !== s.hub) members.push(i);
    }
    members.sort((x, y) => depth[x] - depth[y] || nodes[x].label.localeCompare(nodes[y].label) || x - y);
    const m = members.length;
    const cols = m <= 1 ? 1 : m <= 3 ? 2 : m <= 8 ? 3 : m <= 15 ? 4 : m <= 24 ? 5 : 6;
    const rows = Math.ceil(m / cols);
    const widths = members.map((i) => chipWidth(nodes[i].label));
    const cellW = widths.length > 0 ? Math.max(...widths) : 0;
    const hubW = chipWidth(nodes[s.hub].label, KB2D.HUB_H);
    const gridW = cols * cellW + (cols - 1) * KB2D.GAP_X;
    const w = Math.max(gridW, hubW);
    const h = KB2D.HUB_H + KB2D.HUB_GAP_Y + (rows > 0 ? rows * KB2D.CHIP_H + (rows - 1) * KB2D.GAP_Y : 0);
    return { hub: s.hub, members, w, h, hubW };
  });
  // 3) 块流式布局（按簇顺序，超 ROW_MAX_W 换行，行内整体居中）。
  const rowsBlocks: PlacedBlock[][] = [];
  {
    let row: PlacedBlock[] = [];
    let rowW = 0;
    for (const b of placed) {
      const need = row.length === 0 ? b.w : rowW + KB2D.BLOCK_GAP_X + b.w;
      if (row.length > 0 && need > KB2D.ROW_MAX_W) {
        rowsBlocks.push(row);
        row = [b];
        rowW = b.w;
      } else {
        row.push(b);
        rowW = need;
      }
    }
    if (row.length > 0) rowsBlocks.push(row);
  }
  // 12.12：yTop 改累计行高（原 ri*( 本行 max 高+gap) 行高不等时跨行重叠——
  // 「簇重叠」真根因；与插件同款修复（数值复现：588×104px 块重叠）。
  let yAcc = 0;
  rowsBlocks.forEach((row) => {
    const rowW = row.reduce((acc, b) => acc + b.w, 0) + (row.length - 1) * KB2D.BLOCK_GAP_X;
    let x = -rowW / 2;
    const yTop = yAcc;
    yAcc += Math.max(...row.map((b) => b.h)) + KB2D.BLOCK_GAP_Y;
    for (const b of row) {
      // 行内块顶对齐（hub 横幅一条线，最直观）。
      const cx = x + b.w / 2;
      const hubY = yTop + KB2D.HUB_H / 2;
      pos.set(nodes[b.hub].id, { x: cx, y: hubY });
      size.set(nodes[b.hub].id, { w: b.hubW, h: KB2D.HUB_H });
      sectorOf.set(nodes[b.hub].id, nodes[b.hub].id);
      const m = b.members.length;
      const cols = m <= 1 ? 1 : m <= 3 ? 2 : m <= 8 ? 3 : m <= 15 ? 4 : m <= 24 ? 5 : 6;
      const widths = b.members.map((i) => chipWidth(nodes[i].label));
      const cellW = widths.length > 0 ? Math.max(...widths) : 0;
      const gridX0 = x + (b.w - (cols * cellW + (cols - 1) * KB2D.GAP_X)) / 2;
      const gridY0 = yTop + KB2D.HUB_H + KB2D.HUB_GAP_Y;
      b.members.forEach((i, k) => {
        const r = Math.floor(k / cols);
        const c = k % cols;
        const nw = chipWidth(nodes[i].label);
        const px = gridX0 + c * (cellW + KB2D.GAP_X) + cellW / 2;
        const py = gridY0 + r * (KB2D.CHIP_H + KB2D.GAP_Y) + KB2D.CHIP_H / 2;
        pos.set(nodes[i].id, { x: px, y: py });
        size.set(nodes[i].id, { w: nw, h: KB2D.CHIP_H });
        sectorOf.set(nodes[i].id, nodes[b.hub].id);
      });
      x += b.w + KB2D.BLOCK_GAP_X;
    }
  });
  // 4) 簇块包围盒（含 chip 半宽半高的外扩）。
  const blocks: ClusterBlock[] = placed.map((b) => {
    // 块原点=行内左缘 x0（渲染需 x0——这里从 hub 中心反推）。
    const hubPos = pos.get(nodes[b.hub].id)!;
    return {
      hubId: nodes[b.hub].id,
      minX: hubPos.x - b.w / 2,
      minY: hubPos.y - KB2D.HUB_H / 2 - 8,
      w: b.w + 16,
      h: b.h + 16,
    };
  });
  // 5) 视野自适应。
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  blocks.forEach((b) => {
    minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.minX + b.w); maxY = Math.max(maxY, b.minY + b.h);
  });
  if (!Number.isFinite(minX)) { minX = -380; minY = -210; maxX = 380; maxY = 210; }
  return {
    pos,
    size,
    sectorOf,
    hubs: sectors.map((s) => nodes[s.hub].id),
    blocks,
    view: { minX: minX - KB2D.PAD, minY: minY - KB2D.PAD, width: maxX - minX + KB2D.PAD * 2, height: maxY - minY + KB2D.PAD * 2 },
  };
}

/** GNode 的 virtual 判定（聚合模式 id 带 worker 前缀，virtual 标志仍在原字段）。 */
function nd_virtual(nd: GNode): boolean {
  return Boolean(nd.virtual) || nd.id.startsWith('virtual:');
}

// ── 2D 图谱子组件（v4：簇矩形块 + 缩放/平移 + 聚焦）──────────────────────
// 第 12 轮（装验反馈 9/18 晚「2D 很乱、不够直观、看不清楚」）：
//   ① 布局=簇矩形块（clusterGridLayout）：hub 横幅置顶 + 成员网格，
//      块间大留白，标签水平直排永不重叠（网格保证）——直观=「文件夹」；
//   ② 跨簇边收敛为块-块单线（hub 中心连线、簇对去重）——毛球消失；
//   ③ 簇轮廓虚线框 = 簇分离视觉锚；
//   ④ 缩放/平移/聚焦/悬停高亮/Esc 交互与 v3 一致（wheel 锚点缩放 0.25×–8×）。
export function KnowledgeGraph({
  nodes,
  edges,
  pos,
  size,
  blocks,
  view,
  onSelect,
  agentPalette,
  sectorOf,
  hubs,
}: {
  nodes: GNode[];
  edges: GEdge[];
  pos: Map<string, { x: number; y: number }>;
  /** 节点 id → chip 尺寸（v4 矩形 chip 渲染）。 */
  size: Map<string, { w: number; h: number }>;
  /** 簇块包围盒（v4 虚线框）。 */
  blocks: ClusterBlock[];
  view: RadialView;
  onSelect: (_path: string, _agent?: string) => void;
  /** 聚合模式：按 Worker 着色（插件 agentLegend 同款）。 */
  agentPalette?: { name: string; color: string }[];
  /** 节点 id → 所属簇 hub id（clusterGridLayout 产出，聚焦归属）。 */
  sectorOf?: Map<string, string>;
  /** 簇 hub id 列表（聚焦目标 + 虚线框顺序）。 */
  hubs?: string[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  // v3：当前视野（初始=自适应 view）、聚焦目标、拖拽态。
  const [vb, setVb] = useState<RadialView>(view);
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const [panning, setPanning] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const vbRef = useRef(vb);
  const focusRef = useRef(focus);
  const animRaf = useRef(0);
  const dragRef = useRef<{ startX: number; startY: number; vb0: RadialView; moved: boolean } | null>(null);

  // 布局换图（切 Worker/聚合）→ 重置缩放与聚焦（render 阶段状态调整——
  // React 文档「adjusting state when props change」模式，非 effect setState）。
  const layoutSig = `${view.minX},${view.minY},${view.width},${view.height}#${pos.size}`;
  const [layoutSigRef, setLayoutSigRef] = useState(layoutSig);
  if (layoutSig !== layoutSigRef) {
    setLayoutSigRef(layoutSig);
    setVb(view);
    setFocus(null);
  }
  // 事件处理器/动画帧读 ref 镜像（effect 同步，不在 render 阶段写 ref）。
  useEffect(() => { vbRef.current = vb; });
  useEffect(() => { focusRef.current = focus; });

  const cancelAnim = useCallback(() => {
    if (animRaf.current) cancelAnimationFrame(animRaf.current);
    animRaf.current = 0;
  }, []);
  const animateTo = useCallback((target: RadialView, ms = 320) => {
    cancelAnim();
    const from = { ...vbRef.current };
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3); // easeOutCubic
      setVb({
        minX: from.minX + (target.minX - from.minX) * e,
        minY: from.minY + (target.minY - from.minY) * e,
        width: from.width + (target.width - from.width) * e,
        height: from.height + (target.height - from.height) * e,
      });
      if (k < 1) animRaf.current = requestAnimationFrame(step);
    };
    animRaf.current = requestAnimationFrame(step);
  }, [cancelAnim]);
  useEffect(() => cancelAnim, [cancelAnim]);

  // 簇根集合：优先 radialLayout hubs；缺省回退 virtual 根。
  const hubSet = useMemo(
    () => new Set(hubs && hubs.length > 0 ? hubs : nodes.filter(nd_virtual).map((nd) => nd.id)),
    [hubs, nodes],
  );
  // 聚焦根=virtual 簇根（分类根/Worker 根，非文件）→ 单击=聚焦簇。
  // 伪根（无 virtual 根时取度数 top 文件当 hub）仍是文件 → 单击保持预览，
  // 双击=聚焦其扇区（hubSet 分支）——否则无根图谱全节点都点不开预览。
  const focusHubSet = useMemo(
    () => new Set([...hubSet].filter((id) => {
      const nd = nodes.find((x) => x.id === id);
      return nd ? nd_virtual(nd) : false;
    })),
    [hubSet, nodes],
  );

  // 聚焦集：扇区=全成员；节点=节点+一度邻接。
  const focusSet = useMemo<Set<string> | null>(() => {
    if (!focus) return null;
    const s = new Set<string>();
    if (focus.kind === 'sector') {
      nodes.forEach((nd) => {
        if ((sectorOf?.get(nd.id) ?? nd.id) === focus.hubId) s.add(nd.id);
      });
      if (s.size === 0) s.add(focus.hubId);
    } else {
      s.add(focus.id);
      edges.forEach((e) => {
        if (nodes[e.s].id === focus.id) s.add(nodes[e.t].id);
        if (nodes[e.t].id === focus.id) s.add(nodes[e.s].id);
      });
    }
    return s;
  }, [focus, nodes, edges, sectorOf]);

  const applyFocus = useCallback((target: FocusTarget | null) => {
    cancelAnim();
    setFocus(target);
    if (!target) {
      animateTo(view, 320);
      return;
    }
    const ids = new Set<string>();
    if (target.kind === 'sector') {
      nodes.forEach((nd) => {
        if ((sectorOf?.get(nd.id) ?? nd.id) === target.hubId) ids.add(nd.id);
      });
    } else {
      ids.add(target.id);
      edges.forEach((e) => {
        if (nodes[e.s].id === target.id) ids.add(nodes[e.t].id);
        if (nodes[e.t].id === target.id) ids.add(nodes[e.s].id);
      });
    }
    const pts = [...ids]
      .map((id) => pos.get(id))
      .filter((p): p is { x: number; y: number } => Boolean(p));
    animateTo(focusView(pts) ?? view, 320);
  }, [nodes, edges, pos, sectorOf, view, animateTo, cancelAnim]);

  // Esc 退出聚焦。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && focusRef.current) applyFocus(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applyFocus]);

  // wheel 缩放：原生 non-passive 监听（React 合成 onWheel 为 passive，
  // preventDefault 无效 → 页面会跟着滚）。
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnim();
      const vb0 = vbRef.current;
      const factor = e.deltaY < 0 ? 1 / 1.18 : 1.18;
      let ax = vb0.minX + vb0.width / 2;
      let ay = vb0.minY + vb0.height / 2;
      try {
        const ctm = svg.getScreenCTM();
        if (ctm) {
          const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
          ax = pt.x;
          ay = pt.y;
        } else {
          const rect = svg.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            ax = vb0.minX + ((e.clientX - rect.left) / rect.width) * vb0.width;
            ay = vb0.minY + ((e.clientY - rect.top) / rect.height) * vb0.height;
          }
        }
      } catch {
        /* jsdom：锚点回退视野中心 */
      }
      const w1 = vb0.width * factor;
      const h1 = vb0.height * factor;
      const fx = (ax - vb0.minX) / vb0.width;
      const fy = (ay - vb0.minY) / vb0.height;
      setVb(clampZoomView({ minX: ax - fx * w1, minY: ay - fy * h1, width: w1, height: h1 }, view));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [view, cancelAnim]);

  const zoomBy = useCallback((factor: number) => {
    const vb0 = vbRef.current;
    const w1 = vb0.width * factor;
    const h1 = vb0.height * factor;
    const cx = vb0.minX + vb0.width / 2;
    const cy = vb0.minY + vb0.height / 2;
    animateTo(clampZoomView({ minX: cx - w1 / 2, minY: cy - h1 / 2, width: w1, height: h1 }, view), 160);
  }, [animateTo, view]);

  // 拖拽平移（位移 <4px 视为背景单击 → 退出聚焦）。
  const onSvgMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    cancelAnim();
    dragRef.current = { startX: e.clientX, startY: e.clientY, vb0: { ...vbRef.current }, moved: false };
  };
  const onSvgMouseMove = (e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    const svg = svgRef.current;
    if (!svg) return;
    let scale = d.vb0.width / Math.max(1, svg.getBoundingClientRect().width);
    try {
      const ctm = svg.getScreenCTM();
      if (ctm && ctm.a) scale = 1 / ctm.a;
    } catch {
      /* 回退 bounding rect 换算 */
    }
    if (!panning) setPanning(true);
    setVb({ ...d.vb0, minX: d.vb0.minX - dx * scale, minY: d.vb0.minY - dy * scale });
  };
  const onSvgMouseUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setPanning(false);
    if (d && !d.moved && focusRef.current) applyFocus(null);
  };

  const adjacent = useMemo(() => {
    const set = new Set<number>();
    if (hover != null) {
      set.add(hover);
      edges.forEach((e, i) => {
        if (e.s === hover || e.t === hover) { set.add(i); }
      });
    }
    return set;
  }, [hover, edges]);
  // 跨簇边收敛：同簇对只画一条 hub→hub 线（块-块语义），簇内边=节点级。
  // 注意：必须在空态 early return 之前（hook 顺序铁律）。
  const crossHubEdges = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ i: number; a: string; b: string }> = [];
    edges.forEach((e, i) => {
      const sa = sectorOf?.get(nodes[e.s].id) ?? nodes[e.s].id;
      const sb = sectorOf?.get(nodes[e.t].id) ?? nodes[e.t].id;
      if (sa === sb) return;
      const key = sa < sb ? `${sa}|${sb}` : `${sb}|${sa}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ i, a: sa, b: sb });
    });
    return out;
  }, [edges, nodes, sectorOf]);
  // v4：网格布局标签永不重叠 → 全节点恒挂标签（不再薄化/白名单）。
  if (nodes.length === 0) {
    return <p className="p-4 text-xs text-muted-foreground">该 Worker 暂无知识库文件（MEMORY.md/memory/digest）。</p>;
  }
  const colorOf = (i: number): string => {
    const node = nodes[i];
    if (agentPalette && node.agent) {
      return agentPalette.find((l) => l.name === node.agent)?.color ?? '#8c8c8c';
    }
    return node.isMemory ? '#f59e0b' : '#6366f1';
  };
  const strokeOf = (i: number): string => {
    if (agentPalette && nodes[i].agent) return 'rgba(0,0,0,0.35)';
    return nodes[i].isMemory ? '#b45309' : '#4338ca';
  };
  const dimmed = (id: string): boolean => focusSet != null && !focusSet.has(id);
  const focusLabel = focus
    ? nodes.find((nd) => (focus.kind === 'sector' ? nd.id === focus.hubId : nd.id === focus.id))?.label
    : null;
  const hubColorOf = (hubId: string): string => {
    const i = nodes.findIndex((nd) => nd.id === hubId);
    return i >= 0 ? colorOf(i) : '#8c8c8c';
  };
  return (
    <div className="relative h-full w-full overflow-hidden">
      <svg
        ref={svgRef}
        viewBox={`${vb.minX} ${vb.minY} ${vb.width} ${vb.height}`}
        className="h-full w-full"
        style={{ cursor: panning ? 'grabbing' : 'grab', touchAction: 'none' }}
        role="img"
        aria-label="知识库 wikilink 图谱（滚轮缩放、拖拽平移）"
        onMouseDown={onSvgMouseDown}
        onMouseMove={onSvgMouseMove}
        onMouseUp={onSvgMouseUp}
        onMouseLeave={() => { dragRef.current = null; setPanning(false); }}
      >
        {/* ③ 簇块虚线框（簇分离视觉锚，替代 v3 扇区边界弧）。 */}
        {blocks.map((b) => (
          <rect
            key={`blk-${b.hubId}`}
            x={b.minX}
            y={b.minY}
            width={b.w}
            height={b.h}
            rx={16}
            fill={hubColorOf(b.hubId)}
            fillOpacity={0.045}
            stroke={hubColorOf(b.hubId)}
            strokeOpacity={0.3}
            strokeWidth={1}
            strokeDasharray="4 5"
          />
        ))}
        {/* ②a 簇内边：节点级（chip 之下，悬停邻边高亮）。 */}
        {edges.map((e, i) => {
          const sa = sectorOf?.get(nodes[e.s].id) ?? nodes[e.s].id;
          const sb = sectorOf?.get(nodes[e.t].id) ?? nodes[e.t].id;
          if (sa !== sb) return null; // 跨簇边走下面的 hub 线层
          const a = pos.get(nodes[e.s].id);
          const b = pos.get(nodes[e.t].id);
          if (!a || !b) return null;
          const inFocus = focusSet ? (focusSet.has(nodes[e.s].id) && focusSet.has(nodes[e.t].id) ? 1 : 0.1) : 1;
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={hover != null && adjacent.has(i) ? '#f59e0b' : '#94a3b8'}
              strokeOpacity={(hover == null ? 0.35 : adjacent.has(i) ? 0.9 : 0.1) * inFocus}
              strokeWidth={hover != null && adjacent.has(i) ? 1.8 : 1.2}
            />
          );
        })}
        {/* ②b 跨簇边：簇对去重后的 hub→hub 块级单线（v4 毛球治理）。 */}
        {crossHubEdges.map(({ a, b }) => {
          const pa = pos.get(a);
          const pb = pos.get(b);
          if (!pa || !pb) return null;
          const inFocus = focusSet ? (focusSet.has(a) && focusSet.has(b) ? 1 : 0.15) : 1;
          return (
            <line
              key={`x-${a}-${b}`}
              x1={pa.x}
              y1={pa.y}
              x2={pb.x}
              y2={pb.y}
              stroke={hubColorOf(a)}
              strokeOpacity={0.22 * inFocus}
              strokeWidth={1.4}
            />
          );
        })}
        {/* ① 节点=矩形 chip（标签恒显，网格保证不重叠；悬停=描边加粗+邻接保留）。 */}
        {nodes.map((node, i) => {
          const p = pos.get(node.id);
          const s = size.get(node.id);
          if (!p || !s) return null;
          const isHub = hubSet.has(node.id);
          const dim = dimmed(node.id);
          const hovered = hover === i;
          const active = hover == null || adjacent.has(i);
          // 12.12：截断按 CJK 加权宽逐字累加（与 chipWidth 同口径），不再一律 / FONT_W。
          let usedW = 0;
          let maxChars = 0;
          for (let ci = 0; ci < node.label.length; ci += 1) {
            const cw = textWidthUnits(node.label[ci]);
            if (usedW + cw > s.w - 14) break;
            usedW += cw;
            maxChars = ci + 1;
          }
          maxChars = Math.max(3, maxChars);
          const shown = node.label.length > maxChars ? `${node.label.slice(0, maxChars - 1)}…` : node.label;
          return (
            <g
              key={node.id}
              transform={`translate(${p.x}, ${p.y})`}
              className="cursor-pointer"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={(e) => {
                e.stopPropagation(); // 不触发 svg 背景逻辑（退出聚焦）
                if (focusHubSet.has(node.id)) {
                  applyFocus({ kind: 'sector', hubId: node.id });
                  return;
                }
                onSelect(node.path, node.agent);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (isHub) applyFocus({ kind: 'sector', hubId: node.id });
                else applyFocus({ kind: 'node', id: node.id });
              }}
            >
              <rect
                x={-s.w / 2}
                y={-s.h / 2}
                width={s.w}
                height={s.h}
                rx={s.h / 2}
                fill={colorOf(i)}
                fillOpacity={dim ? 0.06 : hovered ? 0.32 : isHub ? 0.22 : 0.13}
                stroke={strokeOf(i)}
                strokeOpacity={dim ? 0.15 : hovered ? 1 : 0.75}
                strokeWidth={hovered ? 2 : isHub ? 1.6 : 1.2}
              />
              <text
                y={4}
                textAnchor="middle"
                className="select-none"
                fontSize={isHub ? 11.5 : 11}
                fontWeight={isHub ? 600 : 400}
                fill="currentColor"
                opacity={dim ? 0.2 : active ? 0.92 : 0.3}
                style={{ paintOrder: 'stroke' }}
                stroke="var(--card)"
                strokeWidth="3"
                strokeLinejoin="round"
              >
                {shown}
              </text>
              {!dim && <title>{node.label}</title>}
            </g>
          );
        })}
      </svg>
      {/* ② 聚焦 chip（点按退出）。 */}
      {focus && (
        <button
          type="button"
          onClick={() => applyFocus(null)}
          className="absolute left-2 top-2 rounded-md border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-xs text-violet-700 hover:bg-violet-500/20 dark:text-violet-300"
        >
          🎯 {focusLabel ?? '簇'} · 退出
        </button>
      )}
      {/* ① 缩放控制。 */}
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        <button type="button" onClick={() => zoomBy(1 / 1.5)} title="放大" aria-label="放大"
          className="h-6 w-6 rounded-md border border-border bg-background/85 text-sm leading-none hover:bg-accent">＋</button>
        <button type="button" onClick={() => zoomBy(1.5)} title="缩小" aria-label="缩小"
          className="h-6 w-6 rounded-md border border-border bg-background/85 text-sm leading-none hover:bg-accent">－</button>
        <button type="button" onClick={() => { setFocus(null); animateTo(view, 320); }} title="复位视野" aria-label="复位视野"
          className="h-6 w-6 rounded-md border border-border bg-background/85 text-sm leading-none hover:bg-accent">⟳</button>
      </div>
      <div className="pointer-events-none absolute bottom-1 left-2 text-[10px] text-muted-foreground">
        滚轮缩放 · 拖拽平移 · 点簇根聚焦 · 双击节点邻域 · Esc 退出
      </div>
    </div>
  );
}

// ── 主 section ─────────────────────────────────────────────────────────────
export function KnowledgeSection() {
  const { data: workers } = useWorkers();
  const [worker, setWorker] = useState('');
  // 默认 worker 漂移修复（9/16 真机 E2E 实锤）：Controller /api/v1/workers
  // 列表顺序不稳定（k8s list 序），未手动选择时每轮轮询跟 workers[0] 走会
  // 让整个视图静默重置换人（已展开的目录被清掉）。按任务看板同款「推导
  // 选中、不同步状态」惯例（tasks-section effectiveProjectId）：对列表做
  // 确定序（按名）推导默认，跨轮询稳定；用户手动选择后以选择为准。
  const sortedWorkers = useMemo(
    () =>
      [...(workers ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name, 'en'),
      ),
    [workers],
  );
  const effectiveWorker = worker || sortedWorkers[0]?.name || '';

  // 选择记忆（插件 kbState 同款）：worker 列表落地后校验有效性再恢复
  // （失效值回退默认推导，不闪错人）。
  useEffect(() => {
    if (worker || sortedWorkers.length === 0) return;
    const saved = readMem('worker');
    if (saved && sortedWorkers.some((w) => w.name === saved)) {
      const t = setTimeout(() => setWorker(saved), 0);
      return () => clearTimeout(t);
    }
  }, [worker, sortedWorkers]);
  useEffect(() => { writeMem('worker', worker); }, [worker]);

  // 图谱模式 / 聚合团队偏好（持久化）
  const [graphMode, setGraphMode] = useState<'worker' | 'merged'>(
    () => (readMem('graph-mode') === 'merged' ? 'merged' : 'worker'),
  );
  const [kbTeam, setKbTeam] = useState(() => readMem('team')); // ''=全部团队（记忆恢复：团队选择也持久化）
  const [graphVisible, setGraphVisible] = useState(true);
  useEffect(() => { writeMem('graph-mode', graphMode === 'worker' ? '' : 'merged'); }, [graphMode]);

  const [topEntries, setTopEntries] = useState<TreeEntry[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [mergedGraph, setMergedGraph] = useState<GraphData | null>(null);
  const [mergedLoading, setMergedLoading] = useState(false);
  // 预览（v3：独立卡状态——{path, worker}，worker 可≠当前 Worker=聚合跨 Worker 打开）
  const [preview, setPreview] = useState<{ path: string; worker: string } | null>(null);
  const [previewText, setPreviewText] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [expanded, setExpanded] = useState<Record<string, TreeEntry[]>>({});
  const [treeDirsLoading, setTreeDirsLoading] = useState<Record<string, boolean>>({});
  const genRef = useRef(0);
  const mergedGenRef = useRef(0);

  // 团队透传：worker 选择器按 team 分组（optgroup），负责人标记
  // （loadMerged 聚合范围依赖此表，须先定义）
  const teamGroups = useMemo(() => {
    const list: WorkerResponse[] = workers ?? [];
    const map = new Map<string, WorkerResponse[]>();
    for (const wd of list) {
      const team = wd.team || '';
      if (!map.has(team)) map.set(team, []);
      map.get(team)!.push(wd);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => (a === b ? 0 : a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
      .map(([team, list]) => ({
        team,
        workers: [...list].sort((x, y) => x.name.localeCompare(y.name)),
      }));
  }, [workers]);

  // 聚合团队有效值（派生——团队消失时回退全部团队，不同步 setState）。
  // 必须先于 loadMerged 定义（其 useCallback 依赖数组在渲染期求值，
  // const 后置声明会触发 TDZ ReferenceError）。
  const effectiveKbTeam = kbTeam && teamGroups.some((g) => g.team === kbTeam) ? kbTeam : '';
  // workers 列表落地前不写——首帧 teamGroups 为空，派生值必为 ''，
  // 若此时写会覆盖掉刚恢复的合法记忆值（G5 记忆竞态）。
  useEffect(() => {
    if (workers == null) return;
    writeMem('team', effectiveKbTeam);
  }, [workers, effectiveKbTeam]);

  const loadGraph = useCallback(async (w: string) => {
    const gen = ++genRef.current;
    setGraphLoading(true);
    setGraph(null);
    try {
      const ag = await buildAgentGraph(w, MAX_GRAPH_FILES);
      if (gen !== genRef.current) return;
      const pairs = ag.edges.map(
        (e) => [ag.nodes[e.s].id, ag.nodes[e.t].id] as [string, string],
      );
      const { pos, size, blocks, view, sectorOf, hubs } = clusterGridLayout(ag.nodes as GNode[], pairs);
      setGraph({ nodes: ag.nodes as GNode[], edges: ag.edges, pos, size, blocks, view, sectorOf, hubs });
    } catch (err) {
      if (gen === genRef.current) setLoadError(err instanceof Error ? err.message : '加载失败');
    } finally {
      if (gen === genRef.current) setGraphLoading(false);
    }
  }, []);

  // 团队聚合建图（客户端合并——插件 fetchKbGraphMerged 的等价物）：
  // 范围=effectiveKbTeam 团队成员（''=全部 Worker）；总预算 240 文件、单 Worker 60；
  // 节点 id 前缀 `worker::`，边保留各 Worker 内部（跨 Worker 无边=插件同款）。
  const loadMerged = useCallback(async () => {
    const gen = ++mergedGenRef.current;
    setMergedLoading(true);
    setMergedGraph(null);
    try {
      const scope = effectiveKbTeam
        ? teamGroups.find((g) => g.team === effectiveKbTeam)?.workers.map((wd) => wd.name) ?? []
        : sortedWorkers.map((wd) => wd.name);
      // 单 Worker 份额=总预算均分（封顶 150、保底 30）——首 Worker 大 KB 不再
      // 吃掉全员份额（旧版顺序扣减 60/Worker 的升级：4 Worker 仍各 60，
      // 2 Worker 各 120，1 Worker 150）。
      const perWorker = Math.min(
        MAX_GRAPH_FILES,
        Math.max(30, Math.floor(MAX_MERGED_FILES / Math.max(1, scope.length))),
      );
      const nodes: GNode[] = [];
      const edges: GEdge[] = [];
      let budget = MAX_MERGED_FILES;
      for (const w of scope) {
        if (budget <= 0) break;
        const ag = await buildAgentGraph(w, Math.min(perWorker, budget));
        budget -= ag.nodes.length;
        const offset = nodes.length;
        for (const n of ag.nodes) nodes.push({ ...n, id: `${w}::${n.id}`, agent: w });
        for (const e of ag.edges) edges.push({ s: e.s + offset, t: e.t + offset });
      }
      if (gen !== mergedGenRef.current) return;
      const pairs = edges.map(
        (e) => [nodes[e.s].id, nodes[e.t].id] as [string, string],
      );
      const { pos, size, blocks, view, sectorOf, hubs } = clusterGridLayout(nodes, pairs, scope);
      setMergedGraph({ nodes, edges, pos, size, blocks, view, sectorOf, hubs });
    } catch {
      if (gen === mergedGenRef.current) setMergedGraph(null);
    } finally {
      if (gen === mergedGenRef.current) setMergedLoading(false);
    }
  }, [effectiveKbTeam, teamGroups, sortedWorkers]);

  // 聚合范围签名（团队+成员名单）：真正变化才重拉。
  // workers 每 ~15s 轮询换新数组（teamGroups/sortedWorkers 身份随之变），
  // 旧版 effect 依赖身份 → 图谱周期自拉+重排（9/17 装验 G1「过一段时间
  // 就重新加载」根因）。签名不变=跳过；手动「刷新」按钮直调 loadMerged
  // 不经此门，不受影响。
  const mergedScopeKey = useMemo(() => {
    const scope = effectiveKbTeam
      ? teamGroups.find((g) => g.team === effectiveKbTeam)?.workers.map((wd) => wd.name) ?? []
      : sortedWorkers.map((wd) => wd.name);
    return `${effectiveKbTeam || '*'}::${scope.join(',')}`;
  }, [effectiveKbTeam, teamGroups, sortedWorkers]);
  const lastMergedKeyRef = useRef('');
  // 聚合模式：切模式/切团队/范围真变 → 重拉（loadMerged 入口自带清旧图）
  useEffect(() => {
    if (graphMode !== 'merged') return;
    if (mergedScopeKey === lastMergedKeyRef.current) return;
    lastMergedKeyRef.current = mergedScopeKey;
    // 宏任务触发（同 reload effect 模式：effect 内不同步 setState 链）
    const t = setTimeout(() => { void loadMerged(); }, 0);
    return () => clearTimeout(t);
  }, [graphMode, mergedScopeKey, loadMerged]);

  // 顶层文件树（四分类分组来源）+ 图谱，随 Worker 切换/刷新重载
  const reload = useCallback(async (w: string) => {
    setLoadError('');
    setTopEntries(null);
    setLoading(true);
    try {
      setTopEntries(await fetchTree(w, ''));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '文件树加载失败');
    } finally {
      setLoading(false);
    }
    void loadGraph(w);
  }, [loadGraph]);

  // 延迟一个宏任务（同 B5：避免 effect 同步阶段 setState 链）
  useEffect(() => {
    if (!effectiveWorker) return;
    const t = setTimeout(() => {
      setGraph(null);
      setExpanded({});
      setPreview(null);
      void reload(effectiveWorker);
    }, 0);
    return () => clearTimeout(t);
  }, [effectiveWorker, reload]);

  const loadDir = useCallback(async (dir: string) => {
    setTreeDirsLoading((m) => ({ ...m, [dir]: true }));
    try {
      const entries = await fetchTree(effectiveWorker, dir);
      setExpanded((m) => ({ ...m, [dir]: entries }));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '目录加载失败');
    } finally {
      setTreeDirsLoading((m) => ({ ...m, [dir]: false }));
    }
  }, [effectiveWorker]);

  // 下载（对齐插件 KB 文件下载）：file-content?raw=1 原始字节 → blob → a[download]
  const downloadFile = useCallback(async (worker: string, path: string) => {
    try {
      const qs = new URLSearchParams({ path, raw: '1' });
      const res = await fetch(`${base(worker)}/file-content?${qs.toString()}`, { cache: 'no-store' });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error || `下载失败（${res.status}）`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = basename(path);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : '下载失败');
    }
  }, []);

  // 打开预览（v3：agentOverride=聚合模式跨 Worker 打开目标文件，
  // **不切换当前 Worker**——插件 openFile(agentOverride) 同语义；
  // 图谱卡保持不动，只更新预览卡）。
  const openPreview = useCallback(async (path: string, agentOverride?: string) => {
    const w = agentOverride || effectiveWorker;
    setPreview({ path, worker: w });
    setPreviewText('');
    setPreviewError('');
    setPreviewLoading(true);
    try {
      setPreviewText(await fetchFullContent(w, path));
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : '读取失败');
    } finally {
      setPreviewLoading(false);
    }
  }, [effectiveWorker]);

  // 四分类分组（插件同款）：档案=顶层 md / 文件=其余顶层（只列不展开）/ 日记 memory / 知识库 digest
  const groups = useMemo(() => {
    if (topEntries === null) return null;
    const isMd = (e: TreeEntry) => e.kind === 'file' && e.name.toLowerCase().endsWith('.md');
    return {
      archive: topEntries.filter(isMd),
      files: topEntries.filter((e) => e.kind === 'file' && !isMd(e)),
      topDirs: topEntries.filter((e) => e.kind === 'directory' && e.path !== 'memory' && e.path !== 'digest'),
      memory: topEntries.find((e) => e.kind === 'directory' && e.path === 'memory') ?? null,
      digest: topEntries.find((e) => e.kind === 'directory' && e.path === 'digest') ?? null,
    };
  }, [topEntries]);

  // 当前生效图（单 Agent / 聚合）
  const currentGraph = graphMode === 'merged' ? mergedGraph : graph;
  const currentLoading = graphMode === 'merged' ? mergedLoading : graphLoading;
  const mergedScopeCount = graphMode === 'merged'
    ? (effectiveKbTeam
        ? teamGroups.find((g) => g.team === effectiveKbTeam)?.workers.length ?? 0
        : sortedWorkers.length)
    : 0;

  // 聚合图例（节点按 Worker 着色，插件 AGENT_PALETTE 顺序=首次出现序）
  const agentLegend = useMemo(() => {
    if (graphMode !== 'merged' || !currentGraph) return null;
    const order: string[] = [];
    for (const n of currentGraph.nodes) {
      if (n.agent && !order.includes(n.agent)) order.push(n.agent);
    }
    if (order.length === 0) return null;
    return order.map((name, i) => ({ name, color: AGENT_PALETTE[i % AGENT_PALETTE.length] }));
  }, [graphMode, currentGraph]);


  return (
    <div className="space-y-4 p-4">
      <SectionHeader
        title="知识库"
        description="集群 Worker 记忆只读视图（workbench 插件同款数据面：Controller Docker 代理）：档案 / 文件 / 日记 memory/** / 知识库 digest/** + wikilink 2D 图谱（团队聚合）"
        actions={
          <div className="flex items-center gap-2">
            <select
              className="h-8 max-w-[220px] rounded-md border bg-transparent px-2 text-xs"
              value={effectiveWorker}
              onChange={(e) => setWorker(e.target.value)}
              aria-label="选择 Worker（按团队分组）"
            >
              {teamGroups.length === 0 && <option value="">（无 Worker）</option>}
              {teamGroups.map((g) => (
                <optgroup key={g.team || 'ungrouped'} label={g.team || '未分组'}>
                  {g.workers.map((wd) => (
                    <option key={wd.name} value={wd.name}>
                      {wd.name}{/leader/i.test(wd.role || '') ? ' · 负责人' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              disabled={loading || graphLoading || mergedLoading}
              onClick={() => {
                if (!effectiveWorker) return;
                void reload(effectiveWorker);
                if (graphMode === 'merged') void loadMerged();
              }}
            >
              <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading || graphLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              刷新
            </Button>
          </div>
        }
        isRefreshing={loading || graphLoading}
      />

      {loadError ? (
        <div className="flex items-center gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {loadError}
        </div>
      ) : (
        <>
          {/* 图谱模式行（插件同款：当前 Agent 图谱 | 团队聚合图谱 + 聚合团队选择） */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-0.5 rounded-md border border-border/60 bg-transparent p-0.5">
              <Button
                variant={graphMode === 'worker' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setGraphMode('worker')}
              >
                当前 Worker 图谱
              </Button>
              <Button
                variant={graphMode === 'merged' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setGraphMode('merged')}
              >
                <Users className="mr-1 h-3 w-3" aria-hidden="true" />
                团队聚合图谱
              </Button>
            </div>
            {graphMode === 'merged' && teamGroups.length > 0 && (
              <select
                className="h-8 rounded-md border bg-transparent px-2 text-xs"
                value={effectiveKbTeam}
                onChange={(e) => setKbTeam(e.target.value)}
                aria-label="聚合团队"
              >
                <option value="">全部团队（{sortedWorkers.length} Workers）</option>
                {teamGroups.map((g) => (
                  <option key={g.team} value={g.team}>
                    {g.team}（{g.workers.length}）
                  </option>
                ))}
              </select>
            )}
            <span className="ml-auto text-[10px] text-muted-foreground">
              {graphMode === 'merged'
                ? `聚合 ${mergedScopeCount} 个 Worker`
                : effectiveWorker || '—'}
            </span>
          </div>

          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            {/* 左：KB 文件树（四分类，常驻——图谱不再占用此格） */}
            <div className="rounded-md border border-border/60 p-2">
              <div className="mb-2 flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="text-xs font-medium">知识文件</span>
                <span className="ml-auto truncate text-[10px] text-muted-foreground">{effectiveWorker || '—'}</span>
              </div>
              <div className="space-y-0.5">
                {groups === null ? (
                  <div className="flex items-center gap-2 px-1.5 py-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    加载文件树…
                  </div>
                ) : (
                  <>
                    <GroupLabel text="档案" />
                    {groups.archive.map((e) => (
                      <FileRow key={e.path} entry={e} onFile={(p) => void openPreview(p)} />
                    ))}
                    {groups.archive.length === 0 && (
                      <p className="px-4 py-0.5 text-[10px] text-muted-foreground/70">（无顶层 md）</p>
                    )}
                    <GroupLabel text="文件" />
                    {groups.files.map((e) => (
                      <FileRow key={e.path} entry={e} onFile={(p) => void openPreview(p)} />
                    ))}
                    {groups.topDirs.map((e) => (
                      <DirRowReadOnly key={e.path} entry={e} />
                    ))}
                    {groups.files.length === 0 && groups.topDirs.length === 0 && (
                      <p className="px-4 py-0.5 text-[10px] text-muted-foreground/70">（无）</p>
                    )}
                    {(['memory', 'digest'] as const).map((d) => {
                      const root = d === 'memory' ? groups.memory : groups.digest;
                      if (!root) return null;
                      const entries = expanded[root.path];
                      const open = !!entries;
                      return (
                        <div key={root.path}>
                          <GroupLabel text={d === 'memory' ? '日记 memory' : '知识库 digest'} />
                          <button
                            type="button"
                            className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-accent"
                            onClick={() => {
                              if (!open) void loadDir(root.path);
                              else setExpanded((m) => ({ ...m, [root.path]: [] }));
                            }}
                          >
                            {open
                              ? <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                              : <Folder className="h-3.5 w-3.5" aria-hidden="true" />}
                            <span className="truncate font-medium">{root.name}/</span>
                            {treeDirsLoading[root.path] && (
                              <Loader2 className="ml-auto h-3 w-3 animate-spin" aria-hidden="true" />
                            )}
                          </button>
                          {open && (entries ?? []).map((e) => (
                            <TreeRow key={e.path} entry={e} depth={1} onFile={(p) => void openPreview(p)} onDir={(dir) => void loadDir(dir)} loading={treeDirsLoading} expandedMap={expanded} setExpanded={setExpanded} />
                          ))}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </div>

            {/* 右：图谱卡（常驻）+ 预览卡（独立下置） */}
            <div className="min-w-0 space-y-4">
              {/* 图谱卡 */}
              <div className="rounded-md border border-border/60">
                <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
                  <Network className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  <span className="text-xs font-medium">知识图谱（wikilink 引用网络）</span>
                  {currentGraph && (
                    <span className="text-[10px] text-muted-foreground">
                      {currentGraph.nodes.length} 节点 · {currentGraph.edges.length} 边
                    </span>
                  )}
                  {agentLegend ? (
                    <span className="flex items-center gap-2">
                      {agentLegend.map((l) => (
                        <span key={l.name} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <span className="inline-block h-2 w-2 rounded-full" style={{ background: l.color }} />
                          {l.name}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">→ 引用方向</span>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setGraphVisible((v) => !v)}
                    >
                      {graphVisible ? '收起' : '展开'}
                    </Button>
                  </div>
                </div>
                {graphVisible && (
                  <div className="p-3">
                    {currentLoading ? (
                      <div className="flex h-[280px] items-center justify-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        {graphMode === 'merged'
                          ? `构建团队聚合图谱（${mergedScopeCount} 个 Worker，抓取 ≤${MAX_MERGED_FILES} 个 md 文件）…`
                          : `构建 wikilink 图谱（抓取 ≤${MAX_GRAPH_FILES} 个 md 文件）…`}
                      </div>
                    ) : !currentGraph || currentGraph.nodes.length === 0 ? (
                      <div className="flex h-[280px] items-center justify-center text-xs text-muted-foreground">
                        {graphMode === 'merged' ? '团队内暂无知识库文件' : '点「刷新」加载图谱'}
                      </div>
                    ) : (
                      <div className="h-[420px]">
                        <KnowledgeGraph
                          nodes={currentGraph.nodes}
                          edges={currentGraph.edges}
                          pos={currentGraph.pos}
                          size={currentGraph.size}
                          blocks={currentGraph.blocks}
                          view={currentGraph.view}
                          sectorOf={currentGraph.sectorOf}
                          hubs={currentGraph.hubs}
                          onSelect={(p, agent) => {
                            // 分类根/未解析灰点不可点开。
                            if (p.startsWith('virtual:')) return;
                            const nd = currentGraph.nodes.find((x) => x.path === p);
                            if (nd?.resolved === false) return;
                            void openPreview(p, agent);
                          }}
                          agentPalette={agentLegend ?? undefined}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 预览卡（独立——图谱卡永不消失；点节点/文件只更新此卡） */}
              <div className="flex min-h-[140px] flex-col rounded-md border border-border/60">
                <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate text-xs font-medium">{preview ? preview.path : '预览'}</span>
                  {preview && preview.worker !== effectiveWorker && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {preview.worker}
                    </span>
                  )}
                  {preview && !previewLoading && !previewError && previewText && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-6 px-1.5 text-xs"
                      onClick={() => void downloadFile(preview.worker, preview.path)}
                    >
                      <Download className="mr-1 h-3 w-3" aria-hidden="true" />
                      下载
                    </Button>
                  )}
                </div>
                <div className="max-h-[560px] flex-1 overflow-auto p-4">
                  {!preview ? (
                    <p className="py-6 text-center text-xs text-muted-foreground">
                      点击左侧文件查看内容，或点图谱节点直接打开（预览与图谱相互独立）
                    </p>
                  ) : previewLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      读取中（分块 ≤{MAX_CHUNKS * CHUNK / 1024}KB）…
                    </div>
                  ) : previewError ? (
                    <p className="text-xs text-red-600">{previewError}</p>
                  ) : previewText ? (
                    preview.path.toLowerCase().endsWith('.md') ? (
                      <MarkdownMessage content={previewText} />
                    ) : (
                      <pre className="whitespace-pre-wrap text-xs">{previewText}</pre>
                    )
                  ) : (
                    <p className="py-4 text-center text-xs text-muted-foreground">（空文件）</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function GroupLabel({ text }: { text: string }) {
  return (
    <p className="px-1.5 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {text}
    </p>
  );
}

function FileRow({ entry, onFile }: { entry: TreeEntry; onFile: (_p: string) => void }) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-xs hover:bg-accent"
      style={{ paddingLeft: '22px' }}
      onClick={() => onFile(entry.path)}
    >
      <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

/** 顶层目录：只列不展开（插件同款——展开仅限 memory/** 与 digest/**）。 */
function DirRowReadOnly({ entry }: { entry: TreeEntry }) {
  return (
    <div
      className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-muted-foreground"
      style={{ paddingLeft: '22px' }}
      title="顶层目录只列不展开"
    >
      <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{entry.name}/</span>
    </div>
  );
}

function TreeRow({
  entry,
  depth,
  onFile,
  onDir,
  loading,
  expandedMap,
  setExpanded,
}: {
  entry: TreeEntry;
  depth: number;
  onFile: (_path: string) => void;
  onDir: (_dir: string) => void;
  loading: Record<string, boolean>;
  expandedMap: Record<string, TreeEntry[]>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, TreeEntry[]>>>;
}) {
  const entries = expandedMap[entry.path];
  const open = !!entries && entries.length > 0;
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-xs hover:bg-accent"
        style={{ paddingLeft: `${(depth + 1) * 10}px` }}
        onClick={() => {
          if (entry.kind === 'file') onFile(entry.path);
          else if (!open) onDir(entry.path);
          else setExpanded((m) => ({ ...m, [entry.path]: [] }));
        }}
      >
        {entry.kind === 'directory'
          ? (open ? <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />)
          : <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        <span className="truncate">{entry.name}</span>
        {entry.kind === 'directory' && loading[entry.path] && (
          <Loader2 className="ml-auto h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
        )}
      </button>
      {open && (entries ?? []).map((e) => (
        <TreeRow
          key={e.path}
          entry={e}
          depth={depth + 1}
          onFile={onFile}
          onDir={onDir}
          loading={loading}
          expandedMap={expandedMap}
          setExpanded={setExpanded}
        />
      ))}
    </div>
  );
}
