'use client';

import { useMemo, useState, useRef, useEffect } from 'react';
import type { WorkerResponse, TeamResponse, ManagerResponse } from '@/lib/agentteams-api';

interface TopologyNode {
  id: string;
  type: 'manager' | 'team' | 'worker';
  label: string;
  phase: string;
  x: number;
  y: number;
}

interface TopologyEdge {
  source: string;
  target: string;
}

const NODE_COLORS: Record<string, string> = {
  manager: '#8b5cf6',
  team: '#10b981',
  worker: '#2ABC74',
};

const PHASE_FILLS: Record<string, string> = {
  Running: '#10b981',
  Ready: '#22c55e',
  Active: '#10b981',
  Sleeping: '#3b82f6',
  Pending: '#f59e0b',
  Failed: '#ef4444',
  Degraded: '#f97316',
  Stopped: '#6b7280',
  Updating: '#8b5cf6',
};

function buildGraph(
  workers: WorkerResponse[],
  teams: TeamResponse[],
  managers: ManagerResponse[],
  width: number,
  height: number
): { nodes: TopologyNode[]; edges: TopologyEdge[] } {
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];
  const managerCount = managers.length;
  const teamCount = teams.length;

  // Layout: managers at top, teams in middle, workers at bottom
  const managerY = 40;
  const teamY = height * 0.4;
  const workerY = height * 0.75;

  // Managers
  managers.forEach((m, i) => {
    const x = managerCount === 1 ? width / 2 : (width / (managerCount + 1)) * (i + 1);
    nodes.push({ id: m.name, type: 'manager', label: m.name, phase: m.phase, x, y: managerY });
  });

  // Teams
  teams.forEach((t, i) => {
    const x = teamCount === 1 ? width / 2 : (width / (teamCount + 1)) * (i + 1);
    nodes.push({ id: `team-${t.name}`, type: 'team', label: t.teamName || t.name, phase: t.phase, x, y: teamY });

    // Edge: manager → team
    if (t.leaderName) {
      edges.push({ source: t.leaderName, target: `team-${t.name}` });
    }
  });

  // Workers
  const unassigned: WorkerResponse[] = [];
  const byTeam = new Map<string, WorkerResponse[]>();
  for (const w of workers) {
    if (w.team) {
      const list = byTeam.get(w.team) || [];
      list.push(w);
      byTeam.set(w.team, list);
    } else {
      unassigned.push(w);
    }
  }

  let workerIdx = 0;
  const totalWorkers = workers.length;
  for (const w of workers) {
    const x = totalWorkers === 1 ? width / 2 : (width / (totalWorkers + 1)) * (workerIdx + 1);
    nodes.push({ id: `worker-${w.name}`, type: 'worker', label: w.name, phase: w.phase, x, y: workerY });

    if (w.team) {
      const teamNode = teams.find((t) => t.teamName === w.team || t.name === w.team);
      if (teamNode) {
        edges.push({ source: `team-${teamNode.name}`, target: `worker-${w.name}` });
      }
    }
    workerIdx++;
  }

  return { nodes, edges };
}

export function TopologyCanvas({
  workers,
  teams,
  managers,
}: {
  workers: WorkerResponse[];
  teams: TeamResponse[];
  managers: ManagerResponse[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 400 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setSize({ width: entry.contentRect.width, height: Math.max(300, entry.contentRect.height) });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const graph = useMemo(
    () => buildGraph(workers, teams, managers, size.width, size.height),
    [workers, teams, managers, size.width, size.height]
  );

  const nodeMap = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);

  return (
    <div ref={containerRef} className="w-full h-[400px] border border-border rounded-lg bg-card/30 overflow-hidden">
      <svg width={size.width} height={size.height}>
        {/* Layer labels */}
        <text x={12} y={30} className="fill-muted-foreground text-[10px] font-medium">Managers</text>
        <text x={12} y={size.height * 0.4 - 10} className="fill-muted-foreground text-[10px] font-medium">Teams</text>
        <text x={12} y={size.height * 0.75 - 10} className="fill-muted-foreground text-[10px] font-medium">Workers</text>

        {/* Edges */}
        {graph.edges.map((edge, i) => {
          const src = nodeMap.get(edge.source);
          const tgt = nodeMap.get(edge.target);
          if (!src || !tgt) return null;
          const isHighlighted = hoveredNode === edge.source || hoveredNode === edge.target;
          return (
            <line
              key={i}
              x1={src.x}
              y1={src.y + 12}
              x2={tgt.x}
              y2={tgt.y - 12}
              stroke={isHighlighted ? '#2ABC74' : '#64748b'}
              strokeWidth={isHighlighted ? 2 : 1}
              strokeDasharray={isHighlighted ? undefined : '4 2'}
              opacity={isHighlighted ? 1 : 0.4}
            />
          );
        })}

        {/* Nodes */}
        {graph.nodes.map((node) => {
          const color = NODE_COLORS[node.type];
          const phaseFill = PHASE_FILLS[node.phase] || '#6b7280';
          const isHovered = hoveredNode === node.id;
          const radius = node.type === 'manager' ? 14 : node.type === 'team' ? 12 : 8;

          return (
            <g
              key={node.id}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
              style={{ cursor: 'pointer' }}
            >
              {/* Outer ring (phase color) */}
              <circle cx={node.x} cy={node.y} r={radius + 3} fill={phaseFill} opacity={0.3} />
              {/* Main circle */}
              <circle
                cx={node.x}
                cy={node.y}
                r={radius}
                fill={color}
                stroke={isHovered ? '#fff' : 'transparent'}
                strokeWidth={2}
              />
              {/* Label */}
              <text
                x={node.x}
                y={node.y + radius + 14}
                textAnchor="middle"
                className="fill-foreground"
                style={{ fontSize: node.type === 'worker' ? '8px' : '10px', fontWeight: isHovered ? 'bold' : 'normal' }}
              >
                {node.label.length > 12 ? node.label.slice(0, 10) + '…' : node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
