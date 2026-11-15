'use client';

import { useId, useMemo } from 'react';
import { criticalPathOf, layoutProjectDag, type ProjectDag } from '@/lib/project-dag';

/** SVG node colors, keyed by status. Callers pass their own table
 * (task-board statuses vs workflow statuses) so the renderer stays shared. */
export interface DagNodeColor {
  fill: string;
  stroke: string;
  text: string;
}

/** 卡住状态（F5.1）：blocked / revision → 红色警示描边 + 定位入口。 */
const STUCK_STATUSES = new Set(['blocked', 'revision']);

const CRITICAL_STROKE = '#f59e0b';

/**
 * Shared top-down DAG renderer (dependency graph as an SVG). Used by the
 * task board (MinIO data) and the projects section (workflow API data).
 *
 * Layout is computed inside via layoutProjectDag; pass `dag` plus a
 * status→color table. Ready nodes (all deps completed, from `next`) get a
 * cyan dashed border + dot.
 *
 * F5.1 编排可视化强化：
 * - 节点显示责任 Agent（assignee 副行）；
 * - 卡住节点（blocked/revision）红色警示描边，onStuckNodeClick 提供定位
 *   入口（跳对应 Agent 会话）；
 * - 条件边（conditional）虚线；
 * - 关键路径（最长链）节点/边 amber 高亮；
 * - onNodeClick 供上层做接力卡/会话跳转。
 */
export function ProjectDagSvg({
  dag,
  nodeColors,
  nodeWidth = 190,
  nodeHeight = 40,
  gapY = 64,
  title,
  onNodeClick,
  onStuckNodeClick,
  currentNodeId,
  selectedNodeId,
  neutral = false,
}: {
  dag: ProjectDag;
  nodeColors: Record<string, DagNodeColor>;
  nodeWidth?: number;
  nodeHeight?: number;
  gapY?: number;
  /** aria-label for the rendered graph. */
  title?: string;
  /** 节点点击（任意节点：接力卡双向跳转入口）。 */
  onNodeClick?: (_nodeId: string) => void;
  /** 卡住节点点击（跳对应 Agent 会话）；未传时卡住节点仍只有警示样式。 */
  onStuckNodeClick?: (_nodeId: string) => void;
  currentNodeId?: string;
  selectedNodeId?: string;
  neutral?: boolean;
}) {
  const W = nodeWidth;
  const H = nodeHeight;
  const GY = gapY;

  // Per-instance marker id — the task board and the projects topo view can
  // render on the same page; a shared document id would make url(#...) always
  // resolve to the first instance.
  const markerId = useId();
  const layout = useMemo(
    () => layoutProjectDag(dag, { nodeWidth: W, nodeHeight: H, gapY: GY }),
    [dag, W, H, GY],
  );
  const critical = useMemo(() => criticalPathOf(dag), [dag]);
  const { width, height, positions } = layout;
  const renderedHeight = currentNodeId && dag.nodes.length ? Math.max(...dag.nodes.map(node => (positions.get(node.id)?.y ?? 0) + H + (node.assignee ? 12 : 0))) + 12 : height;

  if (dag.nodes.length === 0) return null;

  return (
    <svg
      width={width}
      height={renderedHeight}
      viewBox={`0 0 ${width} ${renderedHeight}`}
      role={onNodeClick || onStuckNodeClick ? 'group' : 'img'}
      aria-label={title ?? '项目任务依赖图'}
    >
      {dag.edges.map((e, i) => {
        const a = positions.get(e.source);
        const b = positions.get(e.target);
        if (!a || !b) return null;
        const x1 = a.x + W / 2;
        const y1 = a.y + H + (dag.nodes.find(node => node.id === e.source)?.assignee ? 12 : 0);
        const x2 = b.x + W / 2;
        const y2 = b.y;
        const my = (y1 + y2) / 2;
        const onCritical = !neutral && critical.has(e.source) && critical.has(e.target);
        return (
          <path
            key={`edge-${i}`}
            d={`M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`}
            fill="none"
            stroke={neutral ? 'var(--muted-foreground)' : onCritical ? CRITICAL_STROKE : 'rgba(148,163,184,0.55)'}
            strokeWidth={onCritical ? 2 : 1.2}
            strokeDasharray={e.conditional ? '4 3' : undefined}
            markerEnd={`url(#${markerId})`}
            opacity={onCritical ? 0.95 : undefined}
          />
        );
      })}
      <defs>
        <marker id={markerId} markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6 Z" fill={neutral ? 'var(--muted-foreground)' : 'rgba(148,163,184,0.7)'} />
        </marker>
      </defs>
      {dag.nodes.map((n) => {
        const p = positions.get(n.id);
        if (!p) return null;
        const colors = nodeColors[n.status] ?? nodeColors.unknown;
        const stuck = STUCK_STATUSES.has(n.status);
        const onCritical = critical.has(n.id);
        const clickable = Boolean(onNodeClick || (stuck && onStuckNodeClick));
        // ~14 CJK glyphs at 11px fit inside the default 190px node width.
        const maxLabel = neutral && n.status === 'completed' ? Math.floor((W - 52) / 12) : W === 190 ? 14 : Math.floor((W - 32) / 12);
        const label = n.title.length > maxLabel ? `${n.title.slice(0, maxLabel)}…` : n.title;
        const assignee = n.assignee && n.assignee.length > 18 ? `${n.assignee.slice(0, 18)}…` : n.assignee;
        const handleClick = () => {
          if (stuck && onStuckNodeClick) onStuckNodeClick(n.id);
          else onNodeClick?.(n.id);
        };
        return (
          <g
            key={n.id}
            onClick={clickable ? handleClick : undefined}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            aria-label={clickable ? `${n.title} · ${n.assignee || '未分配'}` : undefined}
            aria-pressed={clickable ? n.id === selectedNodeId : undefined}
            data-current={n.id === currentNodeId || undefined}
            onKeyDown={clickable ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleClick(); } } : undefined}
            className={clickable ? 'cursor-pointer' : undefined}
          >
            <title>{stuck ? `${n.title}（卡住 — 点击定位责任 Agent）` : n.title}</title>
            {n.id === currentNodeId && <rect x={p.x - 4} y={p.y - 4} width={W + 8} height={H + (assignee ? 12 : 0) + 8} rx={10} fill="none" stroke="currentColor" strokeDasharray="4 3" opacity={0.6} />}
            <rect
              x={p.x}
              y={p.y}
              width={W}
              height={H + (assignee ? 12 : 0)}
              rx={7}
              fill={neutral ? 'var(--card)' : colors.fill}
              stroke={n.id === selectedNodeId ? 'currentColor' : neutral ? 'var(--border)' : stuck ? '#ef4444' : onCritical ? CRITICAL_STROKE : n.ready ? '#22d3ee' : colors.stroke}
              strokeWidth={n.id === selectedNodeId ? 2 : neutral ? 1 : stuck ? 2.2 : onCritical && !n.ready ? 1.8 : n.ready ? 1.8 : 1}
              strokeDasharray={!neutral && n.ready ? '5 3' : undefined}
            />
            {neutral && n.status === 'completed' && <path data-completed="true" aria-label="已完成" d={`M ${p.x + W - 20} ${p.y + 14} l 3 3 l 6 -6`} fill="none" stroke="#16a34a" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
            {!neutral && n.ready && (
              <circle cx={p.x + 10} cy={p.y + H / 2 - (assignee ? 6 : 0)} r={3} fill="#22d3ee" />
            )}
            {!neutral && stuck && (
              <circle cx={p.x + W - 9} cy={p.y + 9} r={3.5} fill="#ef4444">
                <animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite" />
              </circle>
            )}
            <text
              x={p.x + 18}
              y={p.y + (assignee ? H / 2 - 2 : H / 2 + 4)}
              fontSize={currentNodeId ? 12 : 11}
              fill={currentNodeId ? 'currentColor' : colors.text}
              fontFamily="inherit"
            >
              {label}
            </text>
            {assignee && (
              <text
                x={p.x + 18}
                y={p.y + H - 2}
                fontSize={currentNodeId ? 12 : 9}
                fill={currentNodeId ? 'currentColor' : 'rgba(113,113,122,0.9)'}
                fontFamily="inherit"
              >
                @{assignee}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
