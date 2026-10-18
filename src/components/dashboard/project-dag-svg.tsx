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

  if (dag.nodes.length === 0) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={title ?? '项目任务依赖图'}
    >
      {dag.edges.map((e, i) => {
        const a = positions.get(e.source);
        const b = positions.get(e.target);
        if (!a || !b) return null;
        const x1 = a.x + W / 2;
        const y1 = a.y + H;
        const x2 = b.x + W / 2;
        const y2 = b.y;
        const my = (y1 + y2) / 2;
        const onCritical = critical.has(e.source) && critical.has(e.target);
        return (
          <path
            key={`edge-${i}`}
            d={`M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`}
            fill="none"
            stroke={onCritical ? CRITICAL_STROKE : 'rgba(148,163,184,0.55)'}
            strokeWidth={onCritical ? 2 : 1.2}
            strokeDasharray={e.conditional ? '4 3' : undefined}
            markerEnd={`url(#${markerId})`}
            opacity={onCritical ? 0.95 : undefined}
          />
        );
      })}
      <defs>
        <marker id={markerId} markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6 Z" fill="rgba(148,163,184,0.7)" />
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
        const label = n.title.length > 14 ? `${n.title.slice(0, 14)}…` : n.title;
        const assignee = n.assignee && n.assignee.length > 18 ? `${n.assignee.slice(0, 18)}…` : n.assignee;
        const handleClick = () => {
          if (stuck && onStuckNodeClick) onStuckNodeClick(n.id);
          else onNodeClick?.(n.id);
        };
        return (
          <g
            key={n.id}
            onClick={clickable ? handleClick : undefined}
            className={clickable ? 'cursor-pointer' : undefined}
          >
            <title>{stuck ? `${n.title}（卡住 — 点击定位责任 Agent）` : n.title}</title>
            <rect
              x={p.x}
              y={p.y}
              width={W}
              height={H + (assignee ? 12 : 0)}
              rx={7}
              fill={colors.fill}
              stroke={stuck ? '#ef4444' : onCritical ? CRITICAL_STROKE : n.ready ? '#22d3ee' : colors.stroke}
              strokeWidth={stuck ? 2.2 : onCritical && !n.ready ? 1.8 : n.ready ? 1.8 : 1}
              strokeDasharray={n.ready ? '5 3' : undefined}
            />
            {n.ready && (
              <circle cx={p.x + 10} cy={p.y + H / 2 - (assignee ? 6 : 0)} r={3} fill="#22d3ee" />
            )}
            {stuck && (
              <circle cx={p.x + W - 9} cy={p.y + 9} r={3.5} fill="#ef4444">
                <animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite" />
              </circle>
            )}
            <text
              x={p.x + 18}
              y={p.y + (assignee ? H / 2 - 2 : H / 2 + 4)}
              fontSize={11}
              fill={colors.text}
              fontFamily="inherit"
            >
              {label}
            </text>
            {assignee && (
              <text
                x={p.x + 18}
                y={p.y + H - 2}
                fontSize={9}
                fill="rgba(113,113,122,0.9)"
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
