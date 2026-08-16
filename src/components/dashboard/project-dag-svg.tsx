'use client';

import { useId, useMemo } from 'react';
import { layoutProjectDag, type ProjectDag } from '@/lib/project-dag';

/** SVG node colors, keyed by status. Callers pass their own table
 * (task-board statuses vs workflow statuses) so the renderer stays shared. */
export interface DagNodeColor {
  fill: string;
  stroke: string;
  text: string;
}

/**
 * Shared top-down DAG renderer (dependency graph as an SVG). Used by the
 * task board (MinIO data) and the projects section (workflow API data).
 *
 * Layout is computed inside via layoutProjectDag; pass `dag` plus a
 * status→color table. Ready nodes (all deps completed, from `next`) get a
 * cyan dashed border + dot.
 */
export function ProjectDagSvg({
  dag,
  nodeColors,
  nodeWidth = 190,
  nodeHeight = 40,
  gapY = 64,
  title,
}: {
  dag: ProjectDag;
  nodeColors: Record<string, DagNodeColor>;
  nodeWidth?: number;
  nodeHeight?: number;
  gapY?: number;
  /** aria-label for the rendered graph. */
  title?: string;
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
        return (
          <path
            key={`edge-${i}`}
            d={`M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`}
            fill="none"
            stroke="rgba(148,163,184,0.55)"
            strokeWidth={1.2}
            markerEnd={`url(#${markerId})`}
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
        // ~14 CJK glyphs at 11px fit inside the default 190px node width.
        const label = n.title.length > 14 ? `${n.title.slice(0, 14)}…` : n.title;
        return (
          <g key={n.id}>
            <title>{n.title}</title>
            <rect
              x={p.x}
              y={p.y}
              width={W}
              height={H}
              rx={7}
              fill={colors.fill}
              stroke={n.ready ? '#22d3ee' : colors.stroke}
              strokeWidth={n.ready ? 1.8 : 1}
              strokeDasharray={n.ready ? '5 3' : undefined}
            />
            {n.ready && (
              <circle cx={p.x + 10} cy={p.y + H / 2} r={3} fill="#22d3ee" />
            )}
            <text
              x={p.x + 18}
              y={p.y + H / 2 + 4}
              fontSize={11}
              fill={colors.text}
              fontFamily="inherit"
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
