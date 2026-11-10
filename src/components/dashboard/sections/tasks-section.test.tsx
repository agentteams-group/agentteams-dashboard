import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// 9/17 装验反馈回归：任务看板项目视图**右栏详情独立滚动**——
// 详情卡内层必须有 overflow-y-auto + max-h 容器（滚动只动详情，
// 不带着整个页面滚）。mock 面=数据 hooks（组件逻辑不动）。

const FAKE_PROJECT = {
  runId: 'proj-1',
  name: '测试项目',
  status: 'in_progress' as const,
  roomId: '!room:example.org',
  workers: ['w1'],
  phases: [],
  createdAt: 1,
  source: 'minio', // minio 源 → 右栏渲染任务网格（不拉 WorkflowDetail API）
};

vi.mock('@/lib/matrix-store', () => ({
  useMatrixStore: (fn: (_s: unknown) => unknown) => fn({ isLoggedIn: true }),
}));
vi.mock('@/components/dashboard/use-active-section', () => ({
  useActiveSection: () => ({ setActiveSection: vi.fn() }),
}));
vi.mock('@/hooks/use-agentteams-managers', () => ({
  useManagers: () => ({ data: [] }),
}));
vi.mock('@/hooks/use-agentteams-workers', () => ({
  useWorkers: () => ({ data: [] }),
}));
vi.mock('@/hooks/use-projects', () => ({
  useApiTaskBoard: () => ({
    projects: [FAKE_PROJECT],
    tasks: viewPreference.tasks,
    degraded: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks/use-task-board', () => ({
  useMergedTaskBoard: () => ({
    projects: [],
    tasks: [],
    scannedKeys: [],
    matchedPrefixes: [],
    bucket: 'b',
    error: null,
    refetch: vi.fn(),
  }),
  useLogTaskBoardScan: vi.fn(),
}));
vi.mock('@/lib/task-store', () => ({
  useTaskStore: (sel?: (_s: unknown) => unknown) =>
    sel
      ? sel({ tasks: {}, clearTasks: vi.fn() })
      : { tasks: {}, clearTasks: vi.fn() },
}));
vi.mock('@/lib/hitl-inbox', () => ({
  useHitlInboxStore: { getState: () => ({ takePendingProjectKey: () => null }) },
}));
const viewPreference = vi.hoisted(() => ({ value: 'projects', tasks: [] as import('@/hooks/use-task-board').BoardTask[] }));
// 视图模式/选中项目持久化：直接给 projects 视图 + 选中 proj-1
vi.mock('@/lib/use-persistent-state', () => ({
  usePersistentState: (key: string, initial: unknown) => {
    if (key === 'agentteams:tasks-view') return [viewPreference.value, vi.fn()];
    if (key === 'agentteams:tasks-selected-project') return ['proj-1', vi.fn()];
    return [initial, vi.fn()];
  },
}));

import { TasksSection } from './tasks-section';

// 真实 react-query 环境（项目视图的 room 时间戳兜底 hook 走 useQueries；
// 此处 query 均为空列表/不启用，零网络）。
const makeQueryClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
const renderSection = () => {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <TasksSection />
    </QueryClientProvider>,
  );
};

describe('任务看板项目视图：右栏详情独立滚动（9/17 验收反馈）', () => {
  afterEach(() => {
    cleanup();
    viewPreference.value = 'projects';
    viewPreference.tasks = [];
    vi.unstubAllGlobals();
  });

  it('详情卡内容包在 overflow-y-auto + max-h 容器内（滚动不带动整页）', async () => {
    renderSection();
    // 右栏详情落地（项目名多处出现：左栏看板卡 + 右栏详情 h3——取 h3）
    const all = await screen.findAllByText('测试项目');
    const h3 = all.find((el) => el.tagName === 'H3');
    expect(h3).toBeDefined();
    const card = (h3 as Element).closest('[class*="glass-card"]') as HTMLElement | null;
    expect(card).not.toBeNull();
    // 卡片内层滚动容器：overflow-y-auto 且 max-h 封顶（100vh-260px）
    const scroller = card!.querySelector(
      '[class*="overflow-y-auto"][class*="max-h-[calc(100vh-260px)]"]',
    );
    expect(scroller).not.toBeNull();
    // 详情内容在滚动容器内部
    expect(scroller!.contains(h3 as Element)).toBe(true);
  });

  it('项目视图 grid 有显式行轨道 minmax(0,1fr)：h-full 子元素才解析为定高、右栏可滚动（验收第六轮「右边无法滚动」根因回归）', async () => {
    renderSection();
    await screen.findAllByText('测试项目');
    // 外层 grid 容器：固定剩余屏高
    const grid = document.querySelector(
      '[class*="lg:h-[calc(100vh-220px)]"]',
    ) as HTMLElement | null;
    expect(grid).not.toBeNull();
    // 显式单行轨道（缺了它，隐式 auto 轨道让 h-full 百分比解析失败）
    expect(grid!.className).toContain('lg:grid-rows-[minmax(0,1fr)]');
    // 右栏 scroller：lg 下定高滚动（h-full + max-h-none），非 max-h 封顶
    const scroller = grid!.querySelector(
      '[class*="lg:max-h-none"][class*="lg:h-full"][class*="overflow-y-auto"]',
    ) as HTMLElement | null;
    expect(scroller).not.toBeNull();
  });
});

it('shows one restrained empty board instead of eight colored empty columns', () => {
  viewPreference.value = 'kanban';
  renderSection();
  expect(screen.getByText('暂无任务')).toBeInTheDocument();
  expect(screen.queryByText('待办')).toBeNull();
  expect(screen.getByLabelText('任务状态汇总')).toBeInTheDocument();
  cleanup();
  viewPreference.value = 'projects';
});

it('opens the selected task detail and keeps populated groups at a fixed height', async () => {
  viewPreference.value = 'kanban';
  viewPreference.tasks = [{ runId: 'task-demo', title: '检查交付文件', status: 'in_progress', assignedTo: '分析助手', projectId: 'proj-1', roomId: '', dependsOn: [], createdAt: 0, outcome: null, source: 'api' }];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ summary: '核对分析结论和原始文件', status: 'submitted', deliverables: ['报告.md'] }), { status: 200 })));
  renderSection();
  const card = screen.getByRole('button', { name: /检查交付文件/ });
  expect(card.closest('[class*="h-[360px]"]')).not.toBeNull();
  expect(within(card).queryByText('进行中')).toBeNull();
  expect(within(card).getByLabelText('任务正在执行')).toHaveClass('motion-safe:animate-spin');
  expect(card.closest('[class*="h-[360px]"]')?.querySelector('[aria-hidden="true"]')).toHaveClass('motion-safe:animate-pulse');
  fireEvent.click(card);
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(await screen.findByText('核对分析结论和原始文件')).toBeInTheDocument();
  expect(screen.getByText('报告.md')).toBeInTheDocument();
  expect(within(screen.getByRole('dialog')).getByText('待验收')).toBeInTheDocument();
  cleanup();
  vi.unstubAllGlobals();
  viewPreference.value = 'projects';
  viewPreference.tasks = [];
});

it('separates lifecycle columns from attention states and places submitted tasks in review', () => {
  viewPreference.value = 'kanban';
  viewPreference.tasks = [{ runId: 'review-task', title: '待确认的报告', status: 'submitted', assignedTo: '审核', projectId: 'proj-1', roomId: '', dependsOn: [], createdAt: 0, outcome: null, source: 'api' }];
  renderSection();
  const flow = screen.getByRole('region', { name: '任务流程' });
  const attention = screen.getByRole('region', { name: '需要关注' });
  expect(within(flow).getAllByText(/^(待办|已派发|进行中|待验收|已完成)$/).map(el => el.textContent)).toEqual(['待办', '已派发', '进行中', '待验收', '已完成']);
  expect(within(attention).getAllByText(/^(阻塞|需修订|失败)$/).map(el => el.textContent)).toEqual(['阻塞', '需修订', '失败']);
  const card = within(flow).getByRole('button', { name: /待确认的报告/ });
  expect(card.closest('[class*="h-[360px]"]')).toHaveTextContent('待验收');
  expect(within(card).queryByLabelText('任务正在执行')).toBeNull();
  cleanup();
  viewPreference.value = 'projects';
  viewPreference.tasks = [];
});
