export const MERMAID_LIMITS = {
  characters: 16_384,
  nodes: 120,
  edges: 160,
  timeoutMs: 2_000,
} as const;

export type MermaidValidation =
  | { ok: true }
  | { ok: false; reason: string };

/** Cheap preflight bounds avoid sending pathological input to any parser. */
export function validateMermaidBounds(chart: string): MermaidValidation {
  if (chart.length > MERMAID_LIMITS.characters) {
    return { ok: false, reason: `图表超过 ${MERMAID_LIMITS.characters} 字符上限` };
  }
  const edges = (chart.match(/-->|---|-.->|==>|--\s|--\n|--x|--o/g) ?? []).length;
  if (edges > MERMAID_LIMITS.edges) {
    return { ok: false, reason: `图表超过 ${MERMAID_LIMITS.edges} 条连线上限` };
  }
  // Node ids at line starts plus inline declarations. Deliberately conservative:
  // exceeding the bound is safer than allowing an unexpectedly large layout.
  const declaredNodes = chart.split(/\r?\n/).filter((line) => (
    /^\s*[A-Za-z_][\w-]*(?:\s*\[[^\]]*\])?\s*(?:-->|---|-.->|==>|$)/.test(line)
    && !/^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|xychart|block|sankey|packet|architecture|kanban)\b/.test(line.trim())
  )).length;
  if (declaredNodes > MERMAID_LIMITS.nodes) {
    return { ok: false, reason: `图表超过 ${MERMAID_LIMITS.nodes} 个节点上限` };
  }
  return { ok: true };
}
