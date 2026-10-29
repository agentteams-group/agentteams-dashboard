'use client';

import { useCallback, useMemo } from 'react';
import {
  Background,
  Controls,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  type LoopDefinition,
  type LoopEdge,
  type LoopNode,
  type LoopNodeType,
} from '@/lib/loop-definition';

const NODE_TYPE_STYLES: Record<LoopNodeType, { bg: string; border: string; badge: string }> = {
  start: { bg: '#f0fdf4', border: '#22c55e', badge: '起' },
  agent: { bg: '#eff6ff', border: '#3b82f6', badge: 'A' },
  human: { bg: '#fefce8', border: '#eab308', badge: '人' },
  review: { bg: '#faf5ff', border: '#a855f7', badge: '审' },
  condition: { bg: '#fff7ed', border: '#f97316', badge: '条' },
  end: { bg: '#fef2f2', border: '#ef4444', badge: '终' },
};

const NODE_TYPE_LABELS: Record<LoopNodeType, string> = {
  start: '起点',
  agent: 'Agent',
  human: '人工',
  review: '审查',
  condition: '条件',
  end: '终点',
};

function definitionToFlow(def: LoopDefinition): { nodes: Node[]; edges: Edge[] } {
  // 分层初排（layer 同 project-dag 思路）：start=0 列，其余按最长上游链。
  const layerOf = new Map<string, number>();
  const incoming = new Map<string, number>();
  for (const e of def.edges) incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
  const queue = def.nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0).map((n) => n.id);
  for (const id of queue) layerOf.set(id, 0);
  let guard = def.nodes.length + 1;
  while (queue.length > 0 && guard-- > 0) {
    const cur = queue.shift()!;
    const layer = layerOf.get(cur) ?? 0;
    for (const e of def.edges.filter((x) => x.source === cur)) {
      const nextLayer = layer + 1;
      if ((layerOf.get(e.target) ?? -1) < nextLayer) {
        layerOf.set(e.target, nextLayer);
      }
      incoming.set(e.target, (incoming.get(e.target) ?? 1) - 1);
      if ((incoming.get(e.target) ?? 0) <= 0 && !queue.includes(e.target)) queue.push(e.target);
    }
  }
  const perLayer = new Map<number, number>();
  const saved = def.layout;

  const nodes: Node[] = def.nodes.map((n) => {
    const layer = layerOf.get(n.id) ?? 0;
    const index = perLayer.get(layer) ?? 0;
    perLayer.set(layer, index + 1);
    const style = NODE_TYPE_STYLES[n.type];
    return {
      id: n.id,
      position: saved?.[n.id] ?? { x: layer * 230 + 40, y: index * 110 + 40 },
      data: {
        label: (
          <div className="text-left">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span
                className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-xs font-bold text-white"
                style={{ backgroundColor: style.border }}
              >
                {style.badge}
              </span>
              {NODE_TYPE_LABELS[n.type]}
            </div>
            <div className="text-xs font-medium">{n.label}</div>
            {n.assignee && <div className="text-xs text-muted-foreground">@{n.assignee}</div>}
          </div>
        ),
      },
      style: {
        background: style.bg,
        border: `2px solid ${style.border}`,
        borderRadius: 8,
        width: 180,
        padding: 6,
      },
    };
  });

  const edges: Edge[] = def.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: e.conditional === true,
    label: e.label,
    style: e.conditional ? { stroke: '#f97316', strokeDasharray: '5 3' } : undefined,
    labelStyle: { fontSize: 10, fill: '#71717a' },
  }));

  return { nodes, edges };
}

function flowToDefinition(base: LoopDefinition, nodes: Node[], edges: Edge[]): LoopDefinition {
  const loopNodes: LoopNode[] = nodes.map((n) => {
    const existing = base.nodes.find((x) => x.id === n.id);
    const nodeType = (existing?.type ?? 'agent') as LoopNodeType;
    return {
      id: n.id,
      type: nodeType,
      label: typeof n.data.label === 'string' ? n.data.label : existing?.label ?? n.id,
      ...(existing?.assignee ? { assignee: existing.assignee } : {}),
      ...(existing?.description ? { description: existing.description } : {}),
    };
  });
  const loopEdges: LoopEdge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.animated === true ? { conditional: true } : {}),
    ...(typeof e.label === 'string' && e.label ? { label: e.label } : {}),
  }));
  const layout: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) layout[n.id] = n.position;
  return {
    ...base,
    nodes: loopNodes,
    edges: loopEdges,
    layout,
    updatedAt: Date.now(),
  };
}

/**
 * 循环作者画布（PRD F5.2）：节点类型 Agent/人工/审查/条件/起终点；连线
 * 表达交接（animated 虚线 = 条件退回路由）；自动初排 + 手动拖拽微调
 * （位置存 definition.layout）。本组件经 next/dynamic 按需分包，
 * 主 bundle 零画布字节（PRD §8.4 性能预算）。
 */
export default function LoopCanvas({
  definition,
  onChange,
  readOnly,
}: {
  definition: LoopDefinition;
  onChange: (_next: LoopDefinition) => void;
  readOnly?: boolean;
}) {
  const initial = useMemo(() => definitionToFlow(definition), [definition]);
  const [nodes, setNodes, onNodesChangeBase] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState(initial.edges);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChangeBase(changes);
      // 拖动结束的位置变更即时回写（微调持久化到 definition.layout）。
      const moved = changes.filter((c) => c.type === 'position' && c.position);
      if (moved.length > 0 && !readOnly) {
        setNodes((current) => {
          onChange(flowToDefinition(definition, current, edges));
          return current;
        });
      }
    },
    [onNodesChangeBase, setNodes, onChange, definition, edges, readOnly],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) return;
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            id: `e-${connection.source}-${connection.target}-${Date.now().toString(36)}`,
          },
          eds,
        ),
      );
      // addEdge 是异步 state；用最新引用回写（下一帧）。
      queueMicrotask(() => {
        setEdges((current) => {
          onChange(flowToDefinition(definition, nodes, current));
          return current;
        });
      });
    },
    [readOnly, setEdges, onChange, definition, nodes],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      if (readOnly || deleted.length === 0) return;
      queueMicrotask(() => {
        setEdges((current) => {
          onChange(flowToDefinition(definition, nodes, current));
          return current;
        });
      });
    },
    [readOnly, onChange, definition, nodes, setEdges],
  );

  return (
    <div className="h-[480px] rounded-lg border bg-background/40 overflow-hidden" data-testid="loop-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChangeBase}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable={!readOnly}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} />
        <Controls showInteractive={!readOnly} />
      </ReactFlow>
    </div>
  );
}
