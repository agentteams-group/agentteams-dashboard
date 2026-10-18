/**
 * 聊天工作流卡片 live 刷新（第 11 轮）单测。
 *
 * 契约（/tmp/dash-live，main 72e3613 起）：
 *   · 项目卡（runId=项目 id，type≠workerflow）→ 轮询 getProjectWorkflow 正源，
 *     overlay 状态/步骤/参与 Worker，LIVE 徽标显示轮询时间戳
 *   · workerflow 卡（type=workerflow）→ 不探正源（本体靠 m.replace 已 live）
 *   · runId 非项目（404/409/400）→ 停探，渲染快照（无 LIVE 徽标）
 *   · 正源无 overlay 内容（planning 无 DAG）→ 快照兜底，无 LIVE 徽标
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

import { WorkflowCard } from './workflow-card';
import { workflowLiveFromProject, isProjectMiss } from '@/lib/chat-workflow-live';
import { ApiError } from '@/lib/api-error';
import type { WorkflowPayload } from '@/lib/a2ui/workflow';
import type { WorkflowResponse } from '@/lib/agentteams-projects-api';
import { useSectionStore } from '@/lib/section-store';
import { useHitlInboxStore } from '@/lib/hitl-inbox';

const mockWorkflow = vi.fn();
vi.mock('@/lib/agentteams-projects-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agentteams-projects-api')>()),
  getProjectWorkflow: (...args: unknown[]) => mockWorkflow(...args),
}));

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const projectPayload: WorkflowPayload = {
  type: 'project',
  runId: 'proj-42',
  status: 'active',
  title: '官网改版',
  steps: [
    { id: 's1', name: '快照步骤一', status: 'running' },
    { id: 's2', name: '快照步骤二', status: 'pending' },
  ],
  subagents: [{ id: 'w1', name: 'worker-1' }],
};

const liveResponse: WorkflowResponse = {
  project_id: 'proj-42',
  status: 'active',
  title: '官网改版',
  nodes: [
    { id: 'n1', name: '需求拆解', status: 'completed', assignee: 'worker-1' },
    { id: 'n2', name: '编码实现', status: 'in-progress', assignee: 'worker-2' },
    { id: 'n3', name: '集成验收', status: 'pending' },
  ],
  edges: [],
  next: [],
  interrupts: [],
  values: { project_id: 'proj-42', title: '官网改版', status: 'active' },
  tasks_detail: [
    { task_id: 'n1', status: 'completed', assigned_to: 'worker-1', summary: '' },
    { task_id: 'n2', status: 'active', assigned_to: 'worker-2', summary: '' },
    { task_id: 'n2b', status: 'active', assigned_to: 'worker-2', summary: '' },
  ],
};

/** 5 节点 DAG（F1.2 验收口径）：架构 ∥ 视觉 → 设计 → 审查，含依赖边与任务摘要。 */
const relayResponse: WorkflowResponse = {
  project_id: 'proj-relay',
  status: 'active',
  title: '产品介绍页生产线',
  nodes: [
    { id: 't1', name: '架构设计', status: 'completed', assignee: 'arch-bot' },
    { id: 't2', name: '视觉设计', status: 'completed', assignee: 'vision-bot' },
    { id: 't3', name: '页面实现', status: 'in-progress', assignee: 'dev-bot' },
    { id: 't4', name: '内容填充', status: 'pending' },
    { id: 't5', name: '集成审查', status: 'pending', assignee: 'review-bot' },
  ],
  edges: [
    { source: 't1', target: 't3' },
    { source: 't2', target: 't3' },
    { source: 't3', target: 't5' },
    { source: 't4', target: 't5' },
  ],
  next: [],
  interrupts: [],
  values: { project_id: 'proj-relay', title: '产品介绍页生产线', status: 'active' },
  tasks_detail: [
    {
      task_id: 't1',
      status: 'completed',
      assigned_to: 'arch-bot',
      summary: '产出信息架构与泳道划分。',
      deliverables: ['index.html'],
      result_path: 'out/result.md',
    },
    { task_id: 't3', status: 'in-progress', assigned_to: 'dev-bot', summary: '按设计稿实现响应式页面。' },
  ],
};

describe('workflowLiveFromProject（正源 → 卡片 overlay 映射）', () => {
  it('① nodes→steps（name/status/assignee→assignedTo），空 assignee 不带字段', () => {
    const live = workflowLiveFromProject(liveResponse)!;
    expect(live.steps).toEqual([
      { id: 'n1', name: '需求拆解', status: 'completed', assignedTo: 'worker-1' },
      { id: 'n2', name: '编码实现', status: 'in-progress', assignedTo: 'worker-2' },
      { id: 'n3', name: '集成验收', status: 'pending' },
    ]);
    expect(live.status).toBe('active');
    expect(live.title).toBe('官网改版');
  });

  it('② workers=tasks_detail.assigned_to 去重（稳定顺序，worker-2 两条只出现一次）', () => {
    const live = workflowLiveFromProject(liveResponse)!;
    expect(live.subagents).toEqual([
      { id: 'worker-1', name: 'worker-1' },
      { id: 'worker-2', name: 'worker-2' },
    ]);
  });

  it('③ planning（无 DAG 无任务）→ 纯状态 overlay（planning/paused 状态实时有价值），空 steps 由卡片回退快照', () => {
    const live = workflowLiveFromProject({ project_id: 'p', title: '', status: 'planning', nodes: [], edges: [], next: [], interrupts: [] });
    expect(live.status).toBe('planning');
    expect(live.steps).toEqual([]);
    expect(live.subagents).toEqual([]);
  });

  it('③b projectId 透传（接力卡跳转项目详情用）', () => {
    expect(workflowLiveFromProject(liveResponse).projectId).toBe('proj-42');
  });

  it('③c 5 节点 DAG：edges 反推 dependsOn（显示名）、tasks_detail 对齐 summary/assignedTo（F1.2）', () => {
    const live = workflowLiveFromProject(relayResponse);
    const byId = new Map(live.steps.map((s) => [s.id, s]));
    // 并行兄弟（架构/视觉 → 页面实现）：两条上游按 edges 顺序去重
    expect(byId.get('t3')?.dependsOn).toEqual(['架构设计', '视觉设计']);
    expect(byId.get('t5')?.dependsOn).toEqual(['页面实现', '内容填充']);
    // 无上游的首层节点不带 dependsOn 字段
    expect(byId.get('t1')?.dependsOn).toBeUndefined();
    // summary 按 task_id 对齐，空 summary 不带字段
    expect(byId.get('t1')?.summary).toBe('产出信息架构与泳道划分。');
    expect(byId.get('t2')?.summary).toBeUndefined();
    // F1.3：交付物数量与结果路径按 task_id 对齐
    expect(byId.get('t1')?.deliverableCount).toBe(1);
    expect(byId.get('t1')?.resultPath).toBe('out/result.md');
    expect(byId.get('t3')?.deliverableCount).toBeUndefined();
    expect(live.projectId).toBe('proj-relay');
  });
});

describe('isProjectMiss（停探判定）', () => {
  it('④ 404/409/400 = 非项目 → true；500/网络错误/非 ApiError → false', () => {
    expect(isProjectMiss(new ApiError('project not found', 404, 'test'))).toBe(true);
    expect(isProjectMiss(new ApiError('ambiguous', 409, 'test'))).toBe(true);
    expect(isProjectMiss(new ApiError('bad id', 400, 'test'))).toBe(true);
    expect(isProjectMiss(new ApiError('boom', 500, 'test'))).toBe(false);
    expect(isProjectMiss(new Error('network'))).toBe(false);
  });
});

describe('WorkflowCard live overlay（渲染契约）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('⑤ 项目卡：正源接通 → LIVE 徽标 + live 步骤替换快照步骤 + 状态跟正源', async () => {
    mockWorkflow.mockResolvedValue(liveResponse);
    renderWithQuery(<WorkflowCard payload={projectPayload} />);
    expect(await screen.findByText(/live \d{2}:\d{2}:\d{2}/)).toBeInTheDocument();
    // live 步骤（正源）渲染、快照步骤消失
    expect(screen.getByText('需求拆解')).toBeInTheDocument();
    expect(screen.getByText('编码实现')).toBeInTheDocument();
    expect(screen.queryByText('快照步骤一')).not.toBeInTheDocument();
    // 参与 Worker 去重后两位
    expect(screen.getByText('worker-2')).toBeInTheDocument();
    expect(mockWorkflow).toHaveBeenCalledWith('proj-42', { includeTasks: true });
  });

  it('⑥ workerflow 卡：不探正源（0 次请求），渲染快照', async () => {
    const wfPayload: WorkflowPayload = {
      ...projectPayload,
      type: 'workerflow',
      runId: 'run-abc123',
    };
    renderWithQuery(<WorkflowCard payload={wfPayload} />);
    await waitFor(() => expect(screen.getByText('快照步骤一')).toBeInTheDocument());
    expect(mockWorkflow).not.toHaveBeenCalled();
    expect(screen.queryByText(/live \d{2}:\d{2}:\d{2}/)).not.toBeInTheDocument();
  });

  it('⑦ runId 非项目（404）→ 停探 + 快照兜底 + 无 LIVE 徽标', async () => {
    mockWorkflow.mockRejectedValue(new ApiError('project not found', 404, 'test'));
    renderWithQuery(<WorkflowCard payload={projectPayload} />);
    await waitFor(() => expect(mockWorkflow).toHaveBeenCalledTimes(1));
    expect(screen.getByText('快照步骤一')).toBeInTheDocument();
    expect(screen.queryByText(/live \d{2}:\d{2}:\d{2}/)).not.toBeInTheDocument();
    // 停探：再等一轮不会二次请求（refetchInterval=false）
    await new Promise((r) => setTimeout(r, 30));
    expect(mockWorkflow).toHaveBeenCalledTimes(1);
  });

  it('⑧ planning（空 DAG 有状态）→ LIVE 徽标（状态实时）+ 步骤回退快照', async () => {
    mockWorkflow.mockResolvedValue({ project_id: 'proj-42', title: '', status: 'planning', nodes: [], edges: [], next: [], interrupts: [] });
    renderWithQuery(<WorkflowCard payload={projectPayload} />);
    await waitFor(() => expect(mockWorkflow).toHaveBeenCalledTimes(1));
    expect(screen.getByText('快照步骤一')).toBeInTheDocument();
    expect(await screen.findByText(/live \d{2}:\d{2}:\d{2}/)).toBeInTheDocument();
  });
});

describe('RelayCard 接力卡升级（F1.2 渲染契约）', () => {
  const relayPayload: WorkflowPayload = {
    type: 'project',
    runId: 'proj-relay',
    status: 'active',
    title: '产品介绍页生产线',
    steps: [],
    subagents: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('⑨ 步骤行渲染责任 Agent 与依赖副行', async () => {
    mockWorkflow.mockResolvedValue(relayResponse);
    renderWithQuery(<WorkflowCard payload={relayPayload} />);
    await screen.findByText(/live \d{2}:\d{2}:\d{2}/);
    // 责任 Agent
    expect(screen.getByText('@arch-bot')).toBeInTheDocument();
    expect(screen.getByText('@dev-bot')).toBeInTheDocument();
    // 依赖副行（显示名；并行兄弟 → 双上游）
    expect(screen.getByText('依赖：架构设计、视觉设计')).toBeInTheDocument();
    expect(screen.getByText('依赖：页面实现、内容填充')).toBeInTheDocument();
    // 摘要默认收起
    expect(screen.queryByText('产出信息架构与泳道划分。')).not.toBeInTheDocument();
  });

  it('⑩ 有摘要步骤点开显示摘要，再点收起', async () => {
    mockWorkflow.mockResolvedValue(relayResponse);
    renderWithQuery(<WorkflowCard payload={relayPayload} />);
    await screen.findByText(/live \d{2}:\d{2}:\d{2}/);
    const row = screen.getByText('架构设计');
    expect(screen.queryByText('产出信息架构与泳道划分。')).not.toBeInTheDocument();
    fireEvent.click(row);
    expect(screen.getByText('产出信息架构与泳道划分。')).toBeInTheDocument();
    fireEvent.click(row);
    expect(screen.queryByText('产出信息架构与泳道划分。')).not.toBeInTheDocument();
  });

  it('⑩b 展开区渲染工件三态徽标与产物直达链接（F1.3）', async () => {
    mockWorkflow.mockResolvedValue(relayResponse);
    renderWithQuery(<WorkflowCard payload={relayPayload} />);
    await screen.findByText(/live \d{2}:\d{2}:\d{2}/);
    fireEvent.click(screen.getByText('架构设计'));
    // 已完成任务 → released 徽标（M1 依据任务完成态 + 降级 tooltip）
    expect(screen.getByText('已放行')).toBeInTheDocument();
    // 产物链接走任务产物代理
    const link = screen.getByText('result.md');
    expect(link).toHaveAttribute('href', '/api/agentteams/projects/proj-relay/tasks/t1/artifact?path=out%2Fresult.md');
  });

  it('⑪ 正源接通 → 「项目详情」按钮，点击切任务中心并投递 pendingProjectKey', async () => {
    mockWorkflow.mockResolvedValue(relayResponse);
    renderWithQuery(<WorkflowCard payload={relayPayload} />);
    await screen.findByText(/live \d{2}:\d{2}:\d{2}/);
    const btn = screen.getByRole('button', { name: /项目详情/ });
    fireEvent.click(btn);
    expect(useSectionStore.getState().activeSection).toBe('tasks');
    expect(useHitlInboxStore.getState().takePendingProjectKey()).toEqual({ id: 'proj-relay' });
  });

  it('⑫ workerflow 卡（停探）→ 不渲染项目详情入口', async () => {
    const wfPayload: WorkflowPayload = { ...relayPayload, type: 'workerflow', runId: 'run-abc' };
    mockWorkflow.mockResolvedValue(relayResponse);
    renderWithQuery(<WorkflowCard payload={wfPayload} />);
    await waitFor(() => expect(screen.getByText('产品介绍页生产线')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /项目详情/ })).not.toBeInTheDocument();
  });
});
