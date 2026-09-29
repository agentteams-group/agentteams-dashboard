// 知识库模块公共类型（自 knowledge-section.tsx 拆分，A5 纯重构）。
// #1208 D2 / QwenPaw workspace_files.py 实锤形状。

import type { ClusterBlock, RadialView } from './view2d';

export interface TreeEntry {
  kind: 'file' | 'directory';
  name: string;
  path: string;
  size: number | null;
  modified_at: string;
  preview_kind: string;
}
export interface TreeResponse {
  directory: string;
  entries: TreeEntry[];
  has_more: boolean;
  next_cursor: string | null;
}
export interface FileContentResponse {
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
export interface GEdge { s: number; t: number }
export interface GraphData {
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
