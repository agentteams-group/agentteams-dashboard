import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WorkerToolsPanel } from './worker-tools-panel';

const TOOLS = [
  {
    name: 'execute_shell_command',
    enabled: true,
    description: 'Execute a shell command in the worker workspace',
    asyncExecution: false,
    icon: '🔧',
    requiresConfig: false,
  },
  {
    name: 'web_search',
    enabled: false,
    description: 'Search the web',
    asyncExecution: false,
    icon: '🌐',
    requiresConfig: true,
  },
];

type FetchResult = { status: number; body: unknown };
let results: FetchResult[] = [];
let calls: Array<{ url: string; method: string; body?: string }> = [];

function mockFetch(results_: FetchResult[]) {
  results = results_;
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const idx = calls.length;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : undefined;
    calls.push({ url, method, body });
    const r = results[idx] ?? results[0];
    const status = r ? r.status : 200;
    const payload = r ? r.body : { tools: TOOLS, total: TOOLS.length };
    return {
      ok: status < 400,
      status,
      json: async () => payload,
    } as Response;
  });
  vi.stubGlobal('fetch', fn);
}

describe('B6 WorkerToolsPanel（#1255 消费）', () => {
  beforeEach(() => {
    calls = [];
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('① GET 200 → 工具列表载入（名称/描述/需配置徽章）', async () => {
    mockFetch([{ status: 200, body: { tools: TOOLS, total: 2 } }]);
    render(<WorkerToolsPanel workerName="w1" />);
    expect(await screen.findByText('内置工具（声明式保存，切换即生效）')).toBeInTheDocument();
    expect(screen.getByText('execute_shell_command')).toBeInTheDocument();
    expect(screen.getByText('web_search')).toBeInTheDocument();
    expect(screen.getByText('需配置')).toBeInTheDocument();
    expect(calls[0].url).toBe('/api/agentteams/workers/w1/tools');
  });

  it('② GET 404（旧 Controller / L2 跨团队隐藏）→ 占位横幅不报错', async () => {
    mockFetch([{ status: 404, body: { error: 'not found' } }]);
    render(<WorkerToolsPanel workerName="w1" />);
    expect(await screen.findByText(/当前无法加载工具设置/)).toBeInTheDocument();
    expect(screen.queryByText('内置工具（声明式保存，切换即生效）')).not.toBeInTheDocument();
  });

  it('③ GET 400（非 qwenpaw 运行时）→ 错误横幅 + 重试按钮', async () => {
    mockFetch([{ status: 400, body: { error: 'unsupported runtime' } }]);
    render(<WorkerToolsPanel workerName="w1" />);
    expect(await screen.findByText(/加载失败：unsupported runtime/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument();
  });

  it('④ GET 502（worker-local API 不可用）→ 错误横幅带详情', async () => {
    mockFetch([{ status: 502, body: { error: 'tools API unavailable' } }]);
    render(<WorkerToolsPanel workerName="w1" />);
    expect(await screen.findByText(/tools API unavailable/)).toBeInTheDocument();
  });

  it('⑤ 切换启用 → 声明式单字段 PATCH {enabled:false}（路径含编码工具名）', async () => {
    mockFetch([
      { status: 200, body: { tools: TOOLS, total: 2 } },
      {
        status: 200,
        body: {
          name: 'execute_shell_command',
          enabled: false,
          description: 'Execute a shell command in the worker workspace',
          asyncExecution: false,
          icon: '🔧',
          requiresConfig: false,
        },
      },
    ]);
    render(<WorkerToolsPanel workerName="w1" />);
    await screen.findByText('内置工具（声明式保存，切换即生效）');
    fireEvent.click(screen.getByRole('switch', { name: '启用 execute_shell_command' }));
    await waitFor(() =>
      expect(screen.getByText('execute_shell_command 已停用')).toBeInTheDocument(),
    );
    expect(calls[1]).toEqual({
      url: '/api/agentteams/workers/w1/tools/execute_shell_command',
      method: 'PATCH',
      body: '{"enabled":false}',
    });
  });

  it('⑥ 切换异步 → PATCH {asyncExecution:true}', async () => {
    mockFetch([
      { status: 200, body: { tools: TOOLS, total: 2 } },
      {
        status: 200,
        body: {
          name: 'web_search',
          enabled: false,
          asyncExecution: true,
          description: 'Search the web',
          icon: '🌐',
          requiresConfig: true,
        },
      },
    ]);
    render(<WorkerToolsPanel workerName="w1" />);
    await screen.findByText('内置工具（声明式保存，切换即生效）');
    fireEvent.click(screen.getByRole('switch', { name: 'web_search 异步执行' }));
    await waitFor(() =>
      expect(screen.getByText('web_search 已设为异步执行')).toBeInTheDocument(),
    );
    expect(calls[1]).toEqual({
      url: '/api/agentteams/workers/w1/tools/web_search',
      method: 'PATCH',
      body: '{"asyncExecution":true}',
    });
  });

  it('⑦ PATCH 403（Leader 只读）→ 整面板转只读 + 提示 + 本地回滚', async () => {
    mockFetch([
      { status: 200, body: { tools: TOOLS, total: 2 } },
      { status: 403, body: { error: 'read only' } },
    ]);
    render(<WorkerToolsPanel workerName="w1" />);
    await screen.findByText('内置工具（声明式保存，切换即生效）');
    fireEvent.click(screen.getByRole('switch', { name: '启用 execute_shell_command' }));
    await waitFor(() =>
      expect(screen.getByText('当前角色仅可查看，不能修改工具设置')).toBeInTheDocument(),
    );
    // 只读横幅出现后所有开关禁用
    const sw = screen.getByRole('switch', { name: '启用 execute_shell_command' });
    expect(sw).toBeDisabled();
  });

  it('⑧ PATCH 502 → 错误提示 + 本地回滚（开关回到原状态）', async () => {
    mockFetch([
      { status: 200, body: { tools: TOOLS, total: 2 } },
      { status: 502, body: { error: 'tools API unavailable' } },
    ]);
    render(<WorkerToolsPanel workerName="w1" />);
    await screen.findByText('内置工具（声明式保存，切换即生效）');
    const sw = screen.getByRole('switch', { name: '启用 execute_shell_command' });
    expect(sw).toBeChecked();
    fireEvent.click(sw);
    await waitFor(() =>
      expect(screen.getByText(/修改失败：tools API unavailable/)).toBeInTheDocument(),
    );
    await waitFor(() => expect(sw).toBeChecked());
  });

  it('⑨ 工具图标走 SVG（不渲染后端 emoji，未知工具按组回退）', async () => {
    const unknownTool = {
      name: 'mystery_tool',
      enabled: true,
      description: 'Unknown tool',
      asyncExecution: false,
      icon: '🧪',
      requiresConfig: false,
    };
    mockFetch([{ status: 200, body: { tools: [...TOOLS, unknownTool], total: 3 } }]);
    render(<WorkerToolsPanel workerName="w1" runtime="qwenpaw" />);
    await screen.findByText('内置工具（声明式保存，切换即生效）');

    // 后端 emoji 不再出现在 DOM。
    expect(screen.queryByText('🔧')).toBeNull();
    expect(screen.queryByText('🌐')).toBeNull();
    expect(screen.queryByText('🧪')).toBeNull();

    // 已收录工具 → 专属 SVG；未收录工具 → 分组兜底 SVG（同样不是 emoji）。
    expect(screen.getByTestId('tool-icon-execute_shell_command').querySelector('svg')).not.toBeNull();
    expect(screen.getByTestId('tool-icon-web_search').querySelector('svg')).not.toBeNull();
    expect(screen.getByTestId('tool-icon-mystery_tool').querySelector('svg')).not.toBeNull();
  });
});
