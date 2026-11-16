import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// 9/17 装验反馈回归：任务看板项目视图**右栏详情独立滚动**——
// 详情卡内层必须有 overflow-y-auto + max-h 容器（滚动只动详情，
// 不带着整个页面滚）。mock 面=数据 hooks（组件逻辑不动）。

const FAKE_PROJECT = {
  runId: 'proj-1',
  name: '测试项目',
  status: 'active' as const,
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
      ? sel({ tasks: viewPreference.live, clearTasks: vi.fn() })
      : { tasks: viewPreference.live, clearTasks: vi.fn() },
}));
vi.mock('@/lib/hitl-inbox', () => ({
  useHitlInboxStore: { getState: () => ({ takePendingProjectKey: () => null }) },
}));
const viewPreference = vi.hoisted(() => ({ value: 'projects', tasks: [] as import('@/hooks/use-task-board').BoardTask[], live: {} as Record<string, import('@/lib/task-store').TaskEntry> }));
const roomNavigation = vi.hoisted(() => ({ open: vi.fn(), joined: ['!execution:test'] as string[] }));
vi.mock('@/lib/open-chat-room', () => ({ openChatRoom: roomNavigation.open }));
vi.mock('@/hooks/use-chat-room-access', () => ({ useChatRoomAccess: () => ({ state: 'joined', joinedRooms: roomNavigation.joined }) }));
// 视图模式/选中项目持久化：直接给 projects 视图 + 选中 proj-1
vi.mock('@/lib/use-persistent-state', () => ({
  usePersistentState: (key: string, initial: unknown) => {
    if (key === 'agentteams:tasks-view') return [viewPreference.value, vi.fn()];
    if (key === 'agentteams:tasks-selected-project') return ['proj-1', vi.fn()];
    return [initial, vi.fn()];
  },
}));

import { TasksSection } from './tasks-section';
import { TooltipProvider } from '@/components/ui/tooltip';

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
      <TooltipProvider><TasksSection /></TooltipProvider>
    </QueryClientProvider>,
  );
};

describe('任务看板项目视图：右栏详情独立滚动（9/17 验收反馈）', () => {
  it('does not roll accepted subtask progress back when an older completion message is replayed', () => {
    viewPreference.value = 'kanban';
    const base = { projectId: 'proj-1', assignedTo: 'worker', roomId: '', dependsOn: [], createdAt: 0, outcome: null, source: 'api' };
    viewPreference.tasks = [
      { ...base, runId: 'main', title: '交付统计工具', status: 'in_progress' },
      { ...base, runId: 'analysis', parentTaskId: 'main', title: '已验收的需求', status: 'completed' },
    ];
    viewPreference.live = { analysis: { runId: 'analysis', title: '已验收的需求', status: 'submitted', roomId: '!task:test', senderMatrixUserId: 'worker', subagents: [], steps: [], createdAt: 1, updatedAt: 1 } };
    renderSection();
    expect(screen.getByRole('region', { name: '任务流程' })).toHaveTextContent('子任务 1/1 已完成');
  });
  it('shows only main tasks on the board, then opens their subtasks and execution details', async () => {
    viewPreference.value = 'kanban';
    const base = {projectId:'proj-1',teamId:'team',assignedTo:'worker',roomId:'',dependsOn:[],createdAt:0,outcome:null,source:'api'};
    viewPreference.tasks = [
      {...base,runId:'main',title:'交付优先级筛选',status:'in_progress'},
      {...base,runId:'analysis',parentTaskId:'main',title:'分析筛选规则',status:'completed'},
      {...base,runId:'dev',parentTaskId:'main',title:'实现筛选接口',status:'pending',dependsOn:['analysis']},
      {...base,runId:'other-main',title:'另一项独立交付',status:'pending'},
    ];
    renderSection();
    const flow=screen.getByRole('region',{name:'任务流程'});
    expect(within(flow).queryByText('分析筛选规则')).toBeNull();
    expect(within(flow).queryByText('实现筛选接口')).toBeNull();
    expect(within(flow).getByText(/子任务 1\/2 已完成/)).toBeInTheDocument();
    fireEvent.click(within(flow).getByRole('button',{name:/交付优先级筛选/}));
    const sheet=await screen.findByRole('dialog');
    expect(within(sheet).getByRole('region',{name:'子任务列表'})).toHaveTextContent('分析筛选规则');
    fireEvent.click(within(sheet).getByRole('button',{name:/实现筛选接口/}));
    expect(within(sheet).getByRole('button',{name:'返回主任务：交付优先级筛选'})).toBeInTheDocument();
    expect(within(sheet).getByText('前置依赖')).toBeInTheDocument();
  });
  afterEach(() => {
    cleanup();
    viewPreference.value = 'projects';
    viewPreference.tasks = [];
    viewPreference.live = {};
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

describe('task collaboration room entry', () => {
  afterEach(() => {
    cleanup();
    viewPreference.value = 'projects';
    viewPreference.tasks = [];
    viewPreference.live = {};
    roomNavigation.joined = ['!execution:test'];
    roomNavigation.open.mockClear();
    vi.unstubAllGlobals();
  });
  function task() {
    viewPreference.value = 'kanban';
    viewPreference.tasks = [{ runId: 'task-room', title: '执行分析', status: 'in_progress', assignedTo: '分析助手', projectId: 'proj-1', roomId: '!source:test', dependsOn: [], createdAt: 0, outcome: null, source: 'api' }];
  }
  it('moves a refreshed task between columns while keeping the board mounted and ignoring a stale chat status', async () => {
    task();
    viewPreference.tasks[0].status = 'assigned';
    viewPreference.live = { 'task-room': { runId: 'task-room', title: '执行分析', status: 'assigned', roomId: '!source:test', senderMatrixUserId: 'worker', steps: [], subagents: [], createdAt: 0, updatedAt: 1 } };
    const client = makeQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><TooltipProvider>{children}</TooltipProvider></QueryClientProvider>;
    const { rerender } = render(<TasksSection />, { wrapper });
    const card = screen.getByRole('button', { name: /执行分析/ });
    const previousColumn = card.closest('[class*="h-[360px]"]')!;
    expect(previousColumn).toHaveTextContent('已派发');
    viewPreference.tasks = viewPreference.tasks.map(item => ({ ...item, status: 'in_progress' }));
    rerender(<TasksSection />);
    await waitFor(() => expect(within(previousColumn as HTMLElement).queryByRole('button', { name: /执行分析/ })).toBeNull());
    expect(screen.getByRole('button', { name: /执行分析/ }).closest('[class*="h-[360px]"]')).toHaveTextContent('进行中');
    expect(previousColumn.isConnected).toBe(true);
  });
  it('disables an undispatched task room with an explicit reason and makes no metadata request', () => {
    task();
    viewPreference.tasks[0].status = 'pending';
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    renderSection();
    const entry = screen.getByRole('button', { name: '进入协作房间' });
    expect(entry).toBeDisabled();
    expect(entry).toHaveAttribute('title', '任务尚未派发，协作房间未创建');
    fireEvent.click(entry);
    fireEvent.click(entry.parentElement!);
    expect(fetch).not.toHaveBeenCalled();
    expect(roomNavigation.open).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('shows pending-task details without treating an absent task meta file as a server failure', async () => {
    task();
    viewPreference.tasks[0].status = 'pending';
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    renderSection();
    fireEvent.focus(screen.getByRole('button', { name: /执行分析/ }));
    const preview = await screen.findByRole('dialog', { name: '任务预览：执行分析' });
    expect(within(preview).getByText('任务尚未派发，协作房间未创建')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(within(preview).getByRole('button', { name: '查看完整详情' }));
    const detail = await screen.findByRole('dialog', { name: '执行分析' });
    expect(within(detail).getByText('任务尚未派发，协作房间未创建')).toBeInTheDocument();
    expect(within(detail).queryByText('详情暂时无法加载')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps a known execution room reachable even if task dispatch status has not caught up', () => {
    task();
    viewPreference.tasks[0].status = 'pending';
    viewPreference.tasks[0].executionRoomId = '!execution:test';
    renderSection();
    const entry = screen.getByRole('button', { name: '进入协作房间' });
    expect(entry).toBeEnabled();
    fireEvent.click(entry);
    expect(roomNavigation.open).toHaveBeenCalledWith('!execution:test', 'task-room');
  });
  it('keeps the source link and resolves the real collaboration room on click', async () => {
    task();
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ room_id: 'room:!execution:test' }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    renderSection();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '进入协作房间' })).not.toHaveTextContent('进入协作房间');
    expect(screen.getByRole('button', { name: '查看来源会话' })).not.toHaveTextContent('查看来源会话');
    fireEvent.click(screen.getByRole('button', { name: '查看来源会话' }));
    expect(roomNavigation.open).toHaveBeenLastCalledWith('!source:test');
    fireEvent.click(screen.getByRole('button', { name: '进入协作房间' }));
    await vi.waitFor(() => expect(roomNavigation.open).toHaveBeenLastCalledWith('!execution:test', 'task-room'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('opens a lazy preview on focus with real dependencies, assignees and no invented creation time', async () => {
    task();
    viewPreference.tasks.push({ ...viewPreference.tasks[0], runId: 'task-dev', title: '实现修复', assignedTo: '开发助手', status: 'pending', dependsOn: ['task-room'] });
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ history: [{ ts: '2026-11-15T03:00:00Z', action: 'report_progress', to: 'in_progress', note: '已完成需求核对' }] }), { status: 200 })));
    vi.stubGlobal('fetch', fetch);
    renderSection();
    expect(fetch).not.toHaveBeenCalled();
    const card = screen.getByRole('button', { name: /执行分析/ });
    fireEvent.focus(card);
    const preview = await screen.findByRole('dialog', { name: '任务预览：执行分析' });
    expect(await within(preview).findByText('已完成需求核对')).toBeInTheDocument();
    expect(within(preview).getByText('暂未提供')).toBeInTheDocument();
    expect(within(preview).getByText('来源会话')).toBeInTheDocument();
    expect(within(preview).getAllByText('分析助手').length).toBeGreaterThan(0);
    expect(within(preview).getByRole('group', { name: '项目任务分工与依赖' })).toHaveTextContent('开发助手');
    expect(within(preview).getByRole('button', { name: /实现修复/ })).toBeInTheDocument();
    fireEvent.click(within(preview).getByRole('button', { name: /实现修复/ }));
    expect(within(preview).getByText('所选任务：实现修复')).toBeInTheDocument();
    expect(within(preview).getByRole('button', { name: /执行分析/ })).toHaveAttribute('data-current', 'true');
    fireEvent.click(within(preview).getByRole('button', { name: '查看完整详情' }));
    expect(await screen.findByRole('dialog', { name: '执行分析' })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not substitute the source room when there is no execution room', async () => {
    task();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: '进入协作房间' }));
    expect(await screen.findByText('协作房间尚未创建')).toBeInTheDocument();
    expect(roomNavigation.open).not.toHaveBeenCalled();
  });
  it('separates project progress from a completed prerequisite task', async () => {
    task();
    viewPreference.tasks[0].status = 'completed';
    viewPreference.tasks.push({ ...viewPreference.tasks[0], runId: 'downstream', title: '独立验证', status: 'in_progress', assignedTo: '测试助手', dependsOn: ['task-room'] });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('{}', { status: 200 }))));
    renderSection();
    fireEvent.focus(screen.getByRole('button', { name: /执行分析/ }));
    const preview = await screen.findByRole('dialog', { name: '任务预览：执行分析' });
    const project = within(preview).getByRole('region', { name: '项目整体进度' });
    expect(project).toHaveTextContent('测试项目');
    expect(project).toHaveTextContent('进行中');
    expect(project).toHaveTextContent('已完成 1/2');
    expect(within(preview).getByText('连线表示前置依赖，不是父子任务；前置任务完成后，下游任务才能开始。')).toBeInTheDocument();
    expect(within(preview).getByRole('button', { name: /执行分析 ·/ }).querySelector('[data-completed]')).not.toBeNull();
  });
  it('waits for hover intent, stays open when entering the panel, and dismisses with Escape', async () => {
    task();
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('{"summary":"正在核对"}', { status: 200 })));
    vi.stubGlobal('fetch', fetch);
    renderSection();
    const card = screen.getByRole('button', { name: /执行分析/ });
    fireEvent.pointerEnter(card, { pointerType: 'mouse' });
    fireEvent.pointerLeave(card);
    await new Promise(resolve => setTimeout(resolve, 280));
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.pointerEnter(card, { pointerType: 'mouse' });
    const preview = await screen.findByRole('dialog', { name: '任务预览：执行分析' });
    fireEvent.pointerLeave(card);
    fireEvent.pointerEnter(preview, { pointerType: 'mouse' });
    await within(preview).findByText('正在核对');
    await new Promise(resolve => setTimeout(resolve, 230));
    expect(preview).toBeInTheDocument();
    fireEvent.keyDown(preview, { key: 'Escape' });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('opens a workflow execution room directly and isolates keyboard activation from the card', async () => {
    task();
    viewPreference.tasks[0].executionRoomId = '!execution:test';
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    renderSection();
    const entry = screen.getByRole('button', { name: '进入协作房间' });
    fireEvent.keyDown(entry, { key: 'Enter' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(entry);
    expect(roomNavigation.open).toHaveBeenCalledWith('!execution:test', 'task-room');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('also exposes the entry in task details and reuses the loaded task metadata', async () => {
    task();
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ room_id: '!execution:test', summary: '协作详情已加载' }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: /执行分析/ }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('协作详情已加载');
    fireEvent.click(within(dialog).getByRole('button', { name: '进入协作房间' }));
    await vi.waitFor(() => expect(roomNavigation.open).toHaveBeenCalledWith('!execution:test', 'task-room'));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not navigate to an execution room the user has not joined', async () => {
    task();
    roomNavigation.joined = [];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ room_id: '!execution:test' }), { status: 200 })));
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: '进入协作房间' }));
    expect(await screen.findByText('尚未加入协作房间，请联系团队管理员')).toBeInTheDocument();
    expect(roomNavigation.open).not.toHaveBeenCalled();
  });
});
