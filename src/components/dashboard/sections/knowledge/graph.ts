// v4 图谱模型（对齐插件 kb_graph / QwenPaw ReMe graph_snapshot_step）：
//  节点 = md 文件 + 虚拟分类根（digest/{bucket} 非空才生成）
//        + 未解析引用灰点（wikilink 指向不存在的文件，不可点开）；
//  边   = 结构边（分类根→分桶文件，任意深度）
//        + 兜底 hub（无 digest 分桶时 MEMORY.md→depth-1 memory 文件）
//        + [[wikilink]]（含 |alias / #anchor）
//        + →/← 路径块引用（ReMe inlinks/outlinks 行约定）。
//  纯函数（paths+contents → 图），单测直接打，不 mock fetch。
// （自 knowledge-section.tsx 拆分，A5 纯重构。）

import { DIGEST_BUCKETS, extractWikilinks, stem } from './shared';
import type { GEdge, GNode } from './types';

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
