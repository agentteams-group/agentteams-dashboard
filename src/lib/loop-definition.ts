/**
 * Loop definition model (PRD F5.2/F5.3/F5.5, §7.1 对象模型).
 *
 * 循环 = 可发布、可复用、带条件退回的 Agent 工作流定义；执行永远由上游
 * Controller 承载，Dashboard 只做定义/发布/视图/复用（D6 决策）。
 *
 * 状态机（§7.2）：draft → published → archived；已发布版本不可变，
 * 修改生成新草稿/新版本；发布与回滚仅管理员。
 *
 * 存储（§8.3 Stateless 兼容）：Matrix 房间状态事件
 * `com.agentteams.loop.definition`（stateKey = `loop:<id>:v<version>`，
 * 历史天然不覆盖）+ JSON 导出/导入（G3：上游 loops 写 API 未接通时的
 * 降级载体与模板分发通道）。
 */

export type LoopNodeType = 'start' | 'agent' | 'human' | 'review' | 'condition' | 'end';

export interface LoopNode {
  id: string;
  type: LoopNodeType;
  label: string;
  /** agent 节点：责任 Agent（worker 名）。 */
  assignee?: string;
  /** 审查节点：通过判定流向的下游 id（退回路由见 edges 的 conditional）。 */
  description?: string;
}

export interface LoopEdge {
  id: string;
  source: string;
  target: string;
  /** 条件边 = 退回路由（F5.2：单一退回维度，R2 范围控制）。 */
  conditional?: boolean;
  /** 条件边标注（如「不通过退回实现」）。 */
  label?: string;
}

export interface LoopDefinition {
  /** 稳定 id（发布后不变；版本递增）。 */
  id: string;
  name: string;
  description?: string;
  version: number;
  status: 'draft' | 'published' | 'archived' | 'rolled_back';
  nodes: LoopNode[];
  edges: LoopEdge[];
  /** 画布位置快照（F5.2 手动微调持久化；缺省用自动初排）。 */
  layout?: Record<string, { x: number; y: number }>;
  /** 发布元数据（draft 时缺省）。 */
  publishedBy?: string;
  publishedAt?: number;
  updatedBy?: string;
  updatedAt: number;
}

export const LOOP_STATE_EVENT = 'com.agentteams.loop.definition';

/** 内置模板（F5.5：≥5 个）。一键实例化为草稿。 */
export const LOOP_TEMPLATES: Array<Omit<LoopDefinition, 'version' | 'status' | 'updatedAt'>> = [
  {
    id: 'tpl-product-page',
    name: '产品介绍页生产线',
    description: '架构 ∥ 视觉 → 实现 → 内容 → 审查（不通过退回实现）',
    nodes: [
      { id: 'start', type: 'start', label: '开始' },
      { id: 'arch', type: 'agent', label: '架构设计', assignee: 'arch-bot' },
      { id: 'visual', type: 'agent', label: '视觉设计', assignee: 'vision-bot' },
      { id: 'build', type: 'agent', label: '页面实现', assignee: 'dev-bot' },
      { id: 'content', type: 'agent', label: '内容填充', assignee: 'content-bot' },
      { id: 'review', type: 'review', label: '集成审查', assignee: 'review-bot' },
      { id: 'end', type: 'end', label: '结束' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'arch' },
      { id: 'e2', source: 'start', target: 'visual' },
      { id: 'e3', source: 'arch', target: 'build' },
      { id: 'e4', source: 'visual', target: 'build' },
      { id: 'e5', source: 'build', target: 'content' },
      { id: 'e6', source: 'content', target: 'review' },
      { id: 'e7', source: 'review', target: 'end' },
      { id: 'e8', source: 'review', target: 'build', conditional: true, label: '不通过退回实现' },
    ],
  },
  {
    id: 'tpl-code-review',
    name: '代码审查流水线',
    description: '静态检查 → 人工复核 → 修复（条件退回）→ 合入',
    nodes: [
      { id: 'start', type: 'start', label: '开始' },
      { id: 'lint', type: 'agent', label: '静态检查', assignee: 'lint-bot' },
      { id: 'human', type: 'human', label: '人工复核' },
      { id: 'fix', type: 'agent', label: '问题修复', assignee: 'dev-bot' },
      { id: 'recheck', type: 'review', label: '复查', assignee: 'review-bot' },
      { id: 'end', type: 'end', label: '结束' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'lint' },
      { id: 'e2', source: 'lint', target: 'human' },
      { id: 'e3', source: 'human', target: 'fix', conditional: true, label: '有问题' },
      { id: 'e4', source: 'human', target: 'end' },
      { id: 'e5', source: 'fix', target: 'recheck' },
      { id: 'e6', source: 'recheck', target: 'end' },
      { id: 'e7', source: 'recheck', target: 'fix', conditional: true, label: '仍有问题' },
    ],
  },
  {
    id: 'tpl-data-report',
    name: '数据分析报告',
    description: '取数 → 清洗 → 分析 → 报告 → 评审',
    nodes: [
      { id: 'start', type: 'start', label: '开始' },
      { id: 'fetch', type: 'agent', label: '取数', assignee: 'data-bot' },
      { id: 'clean', type: 'agent', label: '清洗', assignee: 'data-bot' },
      { id: 'analyze', type: 'agent', label: '分析', assignee: 'analyst-bot' },
      { id: 'report', type: 'agent', label: '报告生成', assignee: 'writer-bot' },
      { id: 'review', type: 'review', label: '评审', assignee: 'review-bot' },
      { id: 'end', type: 'end', label: '结束' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'fetch' },
      { id: 'e2', source: 'fetch', target: 'clean' },
      { id: 'e3', source: 'clean', target: 'analyze' },
      { id: 'e4', source: 'analyze', target: 'report' },
      { id: 'e5', source: 'report', target: 'review' },
      { id: 'e6', source: 'review', target: 'end' },
      { id: 'e7', source: 'review', target: 'analyze', conditional: true, label: '结论存疑退回分析' },
    ],
  },
  {
    id: 'tpl-weekly-report',
    name: '周报生成',
    description: '汇总各空间动态 → 起草 → 人工润色 → 发布',
    nodes: [
      { id: 'start', type: 'start', label: '开始' },
      { id: 'collect', type: 'agent', label: '动态汇总', assignee: 'ops-bot' },
      { id: 'draft', type: 'agent', label: '起草', assignee: 'writer-bot' },
      { id: 'polish', type: 'human', label: '人工润色' },
      { id: 'end', type: 'end', label: '结束' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'collect' },
      { id: 'e2', source: 'collect', target: 'draft' },
      { id: 'e3', source: 'draft', target: 'polish' },
      { id: 'e4', source: 'polish', target: 'end' },
    ],
  },
  {
    id: 'tpl-doc-polish',
    name: '文档润色',
    description: '初稿 → 术语校对 → 润色 → 终审',
    nodes: [
      { id: 'start', type: 'start', label: '开始' },
      { id: 'terms', type: 'agent', label: '术语校对', assignee: 'doc-bot' },
      { id: 'polish', type: 'agent', label: '润色', assignee: 'writer-bot' },
      { id: 'final', type: 'review', label: '终审', assignee: 'review-bot' },
      { id: 'end', type: 'end', label: '结束' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'terms' },
      { id: 'e2', source: 'terms', target: 'polish' },
      { id: 'e3', source: 'polish', target: 'final' },
      { id: 'e4', source: 'final', target: 'end' },
      { id: 'e5', source: 'final', target: 'polish', conditional: true, label: '退回润色' },
    ],
  },
];

export function templateToDraft(tpl: (typeof LOOP_TEMPLATES)[number], actor: string): LoopDefinition {
  return {
    ...tpl,
    version: 1,
    status: 'draft',
    updatedAt: Date.now(),
    updatedBy: actor,
  };
}

/** 结构校验（导入/状态事件读取共用）：start/end 恰各一、边引用存在节点。 */
export function isValidLoopDefinition(value: unknown): value is LoopDefinition {
  if (!value || typeof value !== 'object') return false;
  const d = value as Partial<LoopDefinition>;
  if (typeof d.id !== 'string' || !d.id) return false;
  if (typeof d.name !== 'string' || !d.name) return false;
  if (typeof d.version !== 'number' || d.version < 1) return false;
  if (d.status !== 'draft' && d.status !== 'published' && d.status !== 'archived') return false;
  if (!Array.isArray(d.nodes) || d.nodes.length === 0) return false;
  if (!Array.isArray(d.edges)) return false;
  const ids = new Set(d.nodes.map((n) => n.id));
  if (!ids.has('start') || !ids.has('end')) return false;
  for (const n of d.nodes) {
    if (typeof n.id !== 'string' || typeof n.label !== 'string') return false;
    if (!ids.has(n.id)) return false;
  }
  for (const e of d.edges) {
    if (typeof e.id !== 'string' || typeof e.source !== 'string' || typeof e.target !== 'string') return false;
    if (!ids.has(e.source) || !ids.has(e.target)) return false;
  }
  if (typeof d.updatedAt !== 'number') return false;
  return true;
}

/** 发布前置校验（F5.3）：至少 start→end 可达；draft 才可发布。 */
export function canPublish(def: LoopDefinition): { ok: boolean; reason?: string } {
  if (def.status !== 'draft') return { ok: false, reason: '仅草稿可发布' };
  const adjacency = new Map<string, string[]>();
  for (const e of def.edges) {
    adjacency.set(e.source, [...(adjacency.get(e.source) ?? []), e.target]);
  }
  const seen = new Set<string>(['start']);
  const queue = ['start'];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of adjacency.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  if (!seen.has('end')) return { ok: false, reason: 'start 无法到达 end，请检查连线' };
  return { ok: true };
}

/** 回滚前置校验（F-3）：已发布且版本 > 1 允许回滚至上一稳定版本。 */
export function canRollback(def: LoopDefinition): { ok: boolean; reason?: string } {
  if (def.status !== 'published') {
    return { ok: false, reason: '仅已发布版本可执行回滚' };
  }
  if (def.version <= 1) {
    return { ok: false, reason: '当前为初始版本 (v1)，无更早版本可回滚' };
  }
  return { ok: true };
}

export interface DryRunStep {
  stepNumber: number;
  nodeId: string;
  nodeLabel: string;
  nodeType: LoopNodeType;
  assignee?: string;
  isConditional?: boolean;
}

export interface DryRunResult {
  reachable: boolean;
  steps: DryRunStep[];
  warnings: string[];
}

interface DryRunEdge {
  target: string;
  conditional?: boolean;
  label?: string;
}

/**
 * 循环预演执行路径拓扑模拟（F-3 预演）：
 * 从 start 节点出发，遍历主干分支推演模拟流转序列；识别孤立节点与条件分流，
 * 让循环作者在正式发布前预先审视拓扑闭环。
 */
export function simulateLoopDryRun(def: LoopDefinition): DryRunResult {
  const warnings: string[] = [];
  const nodeMap = new Map(def.nodes.map((n) => [n.id, n]));
  const adjacency = new Map<string, DryRunEdge[]>();

  for (const e of def.edges) {
    const list = adjacency.get(e.source) ?? [];
    list.push({ target: e.target, conditional: e.conditional, label: e.label });
    adjacency.set(e.source, list);
  }

  const steps: DryRunStep[] = [];
  const visited = new Set<string>();
  let currentId: string | null = 'start';
  let stepCount = 0;

  while (currentId && stepCount < 50) {
    const node = nodeMap.get(currentId);
    if (!node) {
      warnings.push(`拓扑包含不存在的节点引用：${currentId}`);
      break;
    }

    stepCount++;
    steps.push({
      stepNumber: stepCount,
      nodeId: node.id,
      nodeLabel: node.label,
      nodeType: node.type,
      assignee: node.assignee,
    });

    visited.add(currentId);
    if (node.type === 'end') break;

    const outgoing: DryRunEdge[] = adjacency.get(currentId) ?? [];
    if (outgoing.length === 0) {
      warnings.push(`节点 [${node.label}] 无任何出度连线，无法到达终点`);
      break;
    }

    // 优先选择主干（非条件退回边）
    const primary: DryRunEdge | undefined =
      outgoing.find((candidate) => !candidate.conditional) ?? outgoing[0];
    if (!primary) break;
    if (outgoing.some((candidate) => candidate.conditional)) {
      warnings.push(`节点 [${node.label}] 包含条件退回分流，预演遵循主干前进`);
    }

    if (visited.has(primary.target)) {
      warnings.push(`检测到环路回退路由：${currentId} -> ${primary.target}`);
      break;
    }

    currentId = primary.target;
  }

  const reachable = steps.some((s) => s.nodeType === 'end');
  return { reachable, steps, warnings };
}
