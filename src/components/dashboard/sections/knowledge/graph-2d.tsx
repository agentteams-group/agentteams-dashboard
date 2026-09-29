'use client';

// ── 2D 图谱子组件（v4：簇矩形块 + 缩放/平移 + 聚焦）──────────────────────
// 第 12 轮（装验反馈 9/18 晚「2D 很乱、不够直观、看不清楚」）：
//   ① 布局=簇矩形块（clusterGridLayout）：hub 横幅置顶 + 成员网格，
//      块间大留白，标签水平直排永不重叠（网格保证）——直观=「文件夹」；
//   ② 跨簇边收敛为块-块单线（hub 中心连线、簇对去重）——毛球消失；
//   ③ 簇轮廓虚线框 = 簇分离视觉锚；
//   ④ 缩放/平移/聚焦/悬停高亮/Esc 交互与 v3 一致（wheel 锚点缩放 0.25×–8×）。
// （自 knowledge-section.tsx 拆分，A5 纯重构。）

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nd_virtual } from './shared';
import type { GEdge, GNode } from './types';
import {
  clampZoomView,
  focusView,
  textWidthUnits,
  type ClusterBlock,
  type FocusTarget,
  type RadialView,
} from './view2d';

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
