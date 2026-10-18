/**
 * 聊天工作流卡片 live 刷新（第 11 轮，装验反馈 9/18「聊天工作流卡片 live 刷新要」）。
 *
 * 背景（数据链实锤）：
 *   · workerflow 卡（payload.type === 'workerflow'，runId=run-xxxx）= 子代理
 *     fan-out，运行时靠 m.replace 逐版本编辑同一 Matrix 事件——聊天消息管线
 *     （formatMatrixEvents / mergeTimelineEvents）已聚合 m.replace → 本体已 live。
 *   · 项目工作流卡（runId=项目 id）= 一次性发布的快照：任务推进只发生在
 *     controller 侧（/api/v1/projects/{id}/workflow），无人再编辑卡片 → 恒旧。
 *
 * 本模块 = 正源 overlay：把 controller 项目 workflow（与任务看板同一数据源
 * useProjectWorkflow 的 getProjectWorkflow）映射成卡片展示模型，15s 轮询。
 * runId 不是项目（404/409/400）→ 停探，卡片永久回退快照（无 UI 噪音）。
 */

import { ApiError } from '@/lib/api-error';
import type { WorkflowResponse } from '@/lib/agentteams-projects-api';
import type { WorkflowItem } from '@/lib/a2ui/workflow';

export interface ChatWorkflowLive {
  status?: string;
  title?: string;
  /** 项目 id（接力卡 F1.2：跳转任务中心项目详情用）。 */
  projectId?: string;
  steps: WorkflowItem[];
  subagents: WorkflowItem[];
}

/** WorkflowResponse → 卡片 overlay。steps=workflow nodes（status 已归一化，
 * 与任务看板同一口径）；每个 step 附带 assignedTo（node.assignee）、
 * dependsOn（edges 反推的上游显示名，串行链语义）、summary（tasks_detail
 * 按 task_id 对齐）；workers=tasks_detail.assigned_to 去重（稳定顺序）。
 * 恒返回（status 为必返回字段）——planning 等无 DAG 项目=纯状态 overlay，
 * 空 steps/subagents 由卡片逐字段回退快照。查询未成功（含 404 停探）才回退快照。 */
export function workflowLiveFromProject(wf: WorkflowResponse): ChatWorkflowLive {
  const nodes = wf.nodes ?? [];
  // id → 显示名：依赖边存的是 node id，渲染用名字更可读。
  const nameById = new Map(nodes.map((n) => [n.id, n.name] as const));
  // node id → 上游显示名列表（按 edges 顺序去重 → 串行链/并行兄弟可辨）。
  const depsByNodeId = new Map<string, string[]>();
  for (const e of wf.edges ?? []) {
    const list = depsByNodeId.get(e.target) ?? [];
    const upstream = nameById.get(e.source) ?? e.source;
    if (!list.includes(upstream)) list.push(upstream);
    depsByNodeId.set(e.target, list);
  }
  // 任务摘要按 task_id === node.id 对齐（对不上的节点静默省略 summary）。
  const summaryByTaskId = new Map<string, string>();
  for (const t of wf.tasks_detail ?? []) {
    const s = String(t.summary ?? '').trim();
    if (s) summaryByTaskId.set(t.task_id, s);
  }
  const steps: WorkflowItem[] = nodes.map((n) => {
    const dependsOn = depsByNodeId.get(n.id);
    const summary = summaryByTaskId.get(n.id);
    return {
      id: n.id,
      name: n.name,
      status: n.status,
      ...(n.assignee ? { assignedTo: n.assignee } : {}),
      ...(dependsOn ? { dependsOn } : {}),
      ...(summary ? { summary } : {}),
    };
  });
  const seen = new Set<string>();
  const subagents: WorkflowItem[] = [];
  for (const t of wf.tasks_detail ?? []) {
    const a = String(t.assigned_to ?? '').trim();
    if (!a || seen.has(a)) continue;
    seen.add(a);
    subagents.push({ id: a, name: a });
  }
  return { status: wf.status, title: wf.title, projectId: wf.project_id, steps, subagents };
}

/** runId 不是项目（404 无此项目 / 409 跨团队歧义 / 400 非法 id）→ 停探。
 * 5xx / 网络错误 = 暂时性 → 继续轮询（refetchInterval 由调用方按此决定）。 */
export function isProjectMiss(err: unknown): boolean {
  return (
    err instanceof ApiError && (err.status === 404 || err.status === 409 || err.status === 400)
  );
}
