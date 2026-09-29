// 知识库模块共享常量与小工具（自 knowledge-section.tsx 拆分，A5 纯重构）。

import type { GNode } from './types';

// 聚合节点图例配色（插件 AGENT_PALETTE 同值）。
export const AGENT_PALETTE = [
  '#FF7F16', '#1677ff', '#52c41a', '#f5222d', '#722ed1',
  '#fa8c16', '#13c2c2', '#eb2f96',
];

// 选择记忆键（插件 kbState 同款语义：存值、失效回退默认）。
const KB_MEM = 'agentteams:kb:';
export function readMem(key: string): string {
  try { return window.localStorage.getItem(KB_MEM + key) ?? ''; } catch { return ''; }
}
export function writeMem(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(KB_MEM + key, value);
    else window.localStorage.removeItem(KB_MEM + key);
  } catch { /* 存储不可用（隐私模式）=不记忆，不报错 */ }
}

export const base = (w: string) => `/api/agentteams/workers/${encodeURIComponent(w)}/workspace-files`;
export const MAX_GRAPH_FILES = 150; // 单 Worker 图谱内容抓取上限（对齐插件 _KB_MAX_GRAPH_FILES=150）
export const MAX_MERGED_FILES = 240; // 聚合模式全量上限（跨 Worker 总预算）
export const CHUNK = 200_000; // file-content 单块
export const MAX_CHUNKS = 8; // 单文件最多 1.6MB

export const basename = (p: string) => p.split('/').pop() ?? p;
export const stem = (p: string) => (basename(p).toLowerCase().endsWith('.md') ? basename(p).slice(0, -3) : basename(p));

/** wikilink [[title]] / [[title|alias]] / [[title#anchor]] → title */
export function extractWikilinks(md: string): string[] {
  const out: string[] = [];
  const re = /\[\[([^\]|\[\n]+?)(?:#[^\]|\[\n]*)?(?:\|[^\]\n]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const t = m[1].trim();
    if (t) out.push(t);
  }
  return out;
}

/** digest 三虚拟分桶（插件 kb_graph 同款：wiki/personal/procedure）。 */
export const DIGEST_BUCKETS = ['wiki', 'personal', 'procedure'] as const;

/** GNode 的 virtual 判定（聚合模式 id 带 worker 前缀，virtual 标志仍在原字段）。 */
export function nd_virtual(nd: GNode): boolean {
  return Boolean(nd.virtual) || nd.id.startsWith('virtual:');
}
