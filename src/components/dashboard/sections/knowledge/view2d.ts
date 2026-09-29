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
// （自 knowledge-section.tsx 拆分，A5 纯重构。）

import { nd_virtual } from './shared';
import type { GNode } from './types';

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
