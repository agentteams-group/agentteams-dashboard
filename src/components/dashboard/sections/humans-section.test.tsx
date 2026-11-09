import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SearchProvider } from '@/lib/search-context';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import {
  agentteamsApi,
  type HumanConfigRecord,
  type HumanResponse,
} from '@/lib/agentteams-api';
import { HumansSection } from './humans-section';

const human: HumanResponse = {
  name: 'alice',
  displayName: 'Alice',
  phase: 'Active',
  permissionLevel: 2,
  matrixUserID: '@alice:owned.test',
  initialPassword: '',
  rooms: [],
  message: '',
  accessibleTeams: ['team-a'],
  accessibleWorkers: [],
};

const config: HumanConfigRecord = {
  ...human,
  workspaceAccess: { grants: [{ team: 'team-b', paths: ['files/shared/**'], mode: 'read' }] },
};

vi.mock('@/hooks/use-agentteams-humans', () => ({
  useHumans: () => ({
    data: [
      { name: 'admin', displayName: 'System Admin', phase: 'Active', permissionLevel: 1, matrixUserID: '@admin:test', rooms: [], systemAdmin: true },
      {
        name: 'alice',
        displayName: 'Alice',
        phase: 'Active',
        permissionLevel: 2,
        matrixUserID: '@alice:owned.test',
        initialPassword: '',
        rooms: [],
        message: '',
      },
    ],
    isLoading: false,
    isError: false,
    refetch: () => {},
    isRefetching: false,
  }),
}));

vi.mock('@/hooks/use-agentteams-teams', () => ({ useTeams: () => ({ data: [] }) }));
vi.mock('@/hooks/use-agentteams-workers', () => ({ useWorkers: () => ({ data: [] }) }));

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SearchProvider>
        <TooltipProvider>
          <HumansSection />
        </TooltipProvider>
      </SearchProvider>
    </QueryClientProvider>,
  );
}

it('hides the built-in admin from the managed user list', () => {
  renderSection();
  expect(screen.queryByText('System Admin')).not.toBeInTheDocument();
  expect(screen.getByText('Alice')).toBeInTheDocument();
});

beforeEach(() => {
  useAgentTeamsStore.setState({ userLevel: 3, isConnected: true });
  vi.spyOn(agentteamsApi, 'getHuman').mockResolvedValue(human);
  vi.spyOn(agentteamsApi, 'getHumanConfig').mockResolvedValue(config);
  vi.spyOn(agentteamsApi, 'getHumanQuota').mockResolvedValue({
    usedBytes: 1_000,
    quotaBytes: 10_000,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HumansSection 详情 / 编辑入口', () => {
  it('列表点行 → 只读详情弹窗，且弹窗内没有编辑按钮', async () => {
    renderSection();
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '卡片' })).not.toBeInTheDocument();
    fireEvent.click((await screen.findByText('alice')).closest('tr') as HTMLElement);

    expect(await screen.findByText('Human 详情 - alice')).toBeInTheDocument();
    // 编辑抽屉没被一起打开。
    expect(screen.queryByText('访问与权限')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument();
  });

  it('列表「详情」按钮 → 只读详情弹窗', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: '查看 alice 详情' }));
    expect(await screen.findByText('Human 详情 - alice')).toBeInTheDocument();
  });

  it('列表「更多 → 编辑」 → 右侧编辑抽屉（标题 编辑人员 + 四卡）', async () => {
    renderSection();
    fireEvent.pointerDown(await screen.findByRole('button', { name: 'alice 更多操作' }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑' }));

    expect(await screen.findByText('编辑人员')).toBeInTheDocument();
    expect(screen.getByText('访问与权限')).toBeInTheDocument();
    expect(screen.getByText('工作区容量配额')).toBeInTheDocument();
    expect(screen.getByText('模型授权')).toBeInTheDocument();
    expect(screen.getByText('工作区访问')).toBeInTheDocument();
    expect(screen.queryByText('Human 详情 - alice')).not.toBeInTheDocument();
  });

  it('表格行点击 → 只读详情弹窗；表格编辑按钮 → 编辑抽屉', async () => {
    renderSection();
    expect(await screen.findByRole('table')).toBeInTheDocument();

    const row = (await screen.findByText('alice')).closest('tr');
    expect(row).not.toBeNull();
    fireEvent.click(row as HTMLElement);
    expect(await screen.findByText('Human 详情 - alice')).toBeInTheDocument();
    expect(screen.queryByText('访问与权限')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(screen.queryByText('Human 详情 - alice')).not.toBeInTheDocument(),
    );

    fireEvent.pointerDown(screen.getByRole('button', { name: 'alice 更多操作' }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑' }));
    expect(await screen.findByText('编辑人员')).toBeInTheDocument();
    expect(screen.getByText('访问与权限')).toBeInTheDocument();
  });
});
