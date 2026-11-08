import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  agentteamsApi,
  type HumanConfigRecord,
  type HumanResponse,
} from '@/lib/agentteams-api';
import { HumanTable } from './human-table';
import { HumanDrawer } from './human-drawer';
import { HumanDetailDialog } from './human-detail-dialog';

const summary: HumanResponse = {
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
  ...summary,
  modelAccess: {
    scopes: [{ role: '', main: { entries: [{ provider: 'higress', model: 'gpt-5' }] } }],
  },
  workspaceAccess: {
    grants: [{ team: 'team-b', paths: ['files/shared/**'], mode: 'read' }],
  },
};

function renderUi(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>,
  );
}

function Harness({
  userLevel = 3,
  preset = null,
}: {
  userLevel?: number;
  preset?: HumanResponse | null;
}) {
  const [human, setHuman] = useState<HumanResponse | null>(preset);
  return (
    <>
      <HumanTable
        humans={[summary]}
        onView={setHuman}
        onEdit={() => {}}
        onDelete={() => {}}
      />
      <HumanDrawer
        human={human}
        teams={[
          { name: 'team-a', humanMembers: ['alice'] },
          { name: 'team-b' },
        ]}
        workers={[{ name: 'worker-a' }]}
        userLevel={userLevel}
        onOpenChange={(open) => !open && setHuman(null)}
      />
    </>
  );
}

beforeEach(() => {
  vi.spyOn(agentteamsApi, 'getHumanConfig').mockResolvedValue(config);
  vi.spyOn(agentteamsApi, 'getHumanQuota').mockResolvedValue({
    usedBytes: 12_000_000,
    quotaBytes: 1_000_000_000,
  });
  vi.spyOn(agentteamsApi, 'listModelAccessTables').mockResolvedValue({
    supported: true,
    tables: ['shared-grants'],
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HumanDrawer', () => {
  it('puts 详情 and 编辑 side by side and drops the edit action from the detail dialog', async () => {
    renderUi(
      <HumanTable
        humans={[summary]}
        onView={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '查看 alice 详情' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑 alice' })).toBeInTheDocument();
    cleanup();

    vi.spyOn(agentteamsApi, 'getHuman').mockResolvedValue(summary);
    renderUi(<HumanDetailDialog human={summary} onOpenChange={() => {}} />);
    expect(await screen.findByText('Human 详情 - alice')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument(),
    );
  });

  it('opens the right-side drawer from the detail action with the four cards', async () => {
    renderUi(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '查看 alice 详情' }));

    expect(await screen.findByText('访问与权限')).toBeInTheDocument();
    expect(screen.getByText('工作区容量配额')).toBeInTheDocument();
    expect(screen.getByText('模型授权')).toBeInTheDocument();
    expect(screen.getByText('工作区访问')).toBeInTheDocument();
  });

  it('opens one dialog per card', async () => {
    renderUi(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '查看 alice 详情' }));
    await screen.findByText('访问与权限');

    fireEvent.click(screen.getByRole('button', { name: /访问与权限/ }));
    expect(await screen.findByText('访问与权限 · alice')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() =>
      expect(screen.queryByText('访问与权限 · alice')).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /工作区容量配额/ }));
    expect(await screen.findByText('编辑配额 · alice')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() =>
      expect(screen.queryByText('编辑配额 · alice')).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /模型授权/ }));
    expect(await screen.findByText('模型授权 · alice')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() =>
      expect(screen.queryByText('模型授权 · alice')).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: /工作区访问/ }));
    expect(await screen.findByText('工作区访问 · alice')).toBeInTheDocument();
  });

  it('shows the 403 read-only hint and requires the exact name before deleting', async () => {
    renderUi(<Harness userLevel={2} preset={summary} />);
    expect(screen.getByText(/只读（403）/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除人员' })).toBeDisabled();
    cleanup();

    renderUi(<Harness userLevel={3} preset={summary} />);
    fireEvent.click(screen.getByRole('button', { name: '删除人员' }));
    const confirm = await screen.findByRole('button', { name: '删除' });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('输入 alice 以确认删除'), {
      target: { value: 'alice' },
    });
    expect(confirm).toBeEnabled();
  });
});
