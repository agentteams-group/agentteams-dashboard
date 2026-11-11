import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { TeamMembersPanel } from './team-members-panel';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import type { ModelSelectionOption } from '@/lib/model-catalog';

const mocks = vi.hoisted(() => ({
  updateWorkerMutate: vi.fn(),
  updateWorkerMutateAsync: vi.fn(),
  updateTeamMutateAsync: vi.fn(),
}));

vi.mock('@/hooks/use-agentteams-mutations', () => ({
  useUpdateTeam: () => ({ mutateAsync: mocks.updateTeamMutateAsync, isPending: false }),
  useUpdateWorker: () => ({
    mutate: mocks.updateWorkerMutate,
    mutateAsync: mocks.updateWorkerMutateAsync,
    isPending: false,
  }),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!('ResizeObserver' in window)) {
  Object.defineProperty(window, 'ResizeObserver', {
    value: ResizeObserverStub,
    configurable: true,
  });
}

const LONG_NAME = 'worker-with-a-very-long-name-that-must-not-squeeze-actions';

function worker(name: string, modelProvider?: string): WorkerResponse {
  return {
    name,
    phase: 'Running',
    state: 'Running',
    containerManaged: true,
    model: `${name}-model`,
    modelProvider,
    runtime: 'qwenpaw',
    image: 'img:latest',
    containerState: 'running',
    matrixUserID: `@${name}:server`,
    roomID: `!${name}:server`,
    message: '',
    team: 'alpha',
    role: 'worker',
    skills: [],
    mcpServers: [],
  } as unknown as WorkerResponse;
}

const team = {
  name: 'alpha',
  teamName: 'Alpha',
  leaderName: LONG_NAME,
  workerNames: ['w1'],
} as unknown as TeamResponse;

describe('TeamMembersPanel · 成员行布局', () => {
  afterEach(() => {
    cleanup();
    mocks.updateWorkerMutate.mockReset();
    mocks.updateWorkerMutateAsync.mockReset();
    mocks.updateTeamMutateAsync.mockReset();
  });

  it('姓名占满第一行剩余空间，角色/改模型/移除按钮不被挤压', () => {
    render(
      <TooltipProvider>
        <TeamMembersPanel
          team={team}
          workers={[worker(LONG_NAME), worker('w1')]}
          modelOptions={[]}
        />
      </TooltipProvider>,
    );

    const leaderRow = screen.getByTestId(`member-${LONG_NAME}`);
    const name = within(leaderRow).getByText(LONG_NAME);
    expect(name).toHaveAttribute('title', LONG_NAME);
    expect(name.className).toContain('flex-1');
    expect(name.className).toContain('truncate');

    expect(within(leaderRow).getByText('Leader')).toBeInTheDocument();
    const change = within(leaderRow).getByRole('button', { name: '改模型' });
    expect(change.className).toContain('shrink-0');

    // 两行固定结构：外层不再 flex-wrap，模型与移除在第二行。
    expect(leaderRow.className).not.toContain('flex-wrap');
    expect(within(leaderRow).getByText(`${LONG_NAME}-model`)).toBeInTheDocument();

    const workerRow = screen.getByTestId('member-w1');
    const remove = within(workerRow).getByRole('button', { name: '移除 w1' });
    expect(remove.className).toContain('shrink-0');
    expect(within(workerRow).getByRole('button', { name: '改模型' })).toBeInTheDocument();
  });

  it('行内改模型把当前 provider 传入弹窗；provider 未改时只下发 model', () => {
    render(
      <TooltipProvider>
        <TeamMembersPanel
          team={team}
          workers={[worker(LONG_NAME), worker('w1', 'provider-a')]}
          modelOptions={[]}
        />
      </TooltipProvider>,
    );

    fireEvent.click(within(screen.getByTestId('member-w1')).getByRole('button', { name: '改模型' }));

    const dialog = screen.getByRole('dialog');
    // 行内与批量共用同一个模型弹窗（标题区分场景）。
    expect(within(dialog).getByText('编辑模型 - w1')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Provider')).toHaveValue('provider-a');

    fireEvent.change(within(dialog).getByLabelText('请求模型别名'), {
      target: { value: 'w1-model-v2' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));

    expect(mocks.updateWorkerMutate).toHaveBeenCalledWith(
      { name: 'w1', data: { model: 'w1-model-v2' } },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });
});

function option(alias: string, providerName: string): ModelSelectionOption {
  return {
    alias,
    kind: 'configured',
    binding: {
      requestModelAlias: alias,
      routeName: `route-${alias}`,
      providerName,
      targetModel: `target-${alias}`,
      available: true,
    },
  };
}

function renderPanel(modelOptions: ModelSelectionOption[] = []) {
  return render(
    <TooltipProvider>
      <TeamMembersPanel
        team={team}
        workers={[worker(LONG_NAME), worker('w1')]}
        modelOptions={modelOptions}
      />
    </TooltipProvider>,
  );
}

describe('TeamMembersPanel · 批量模型画笔', () => {
  afterEach(() => {
    cleanup();
    mocks.updateWorkerMutate.mockReset();
    mocks.updateWorkerMutateAsync.mockReset();
    mocks.updateTeamMutateAsync.mockReset();
  });

  it('批量区不再渲染内联下拉，只有两段摘要和两个「设置模型」按钮', () => {
    renderPanel();

    const leader = screen.getByTestId('batch-leader');
    const workers = screen.getByTestId('batch-workers');
    for (const column of [leader, workers]) {
      expect(within(column).queryByLabelText('Provider')).toBeNull();
      expect(within(column).queryByLabelText('请求模型别名')).toBeNull();
      expect(within(column).getByText('未设置（留空 = 不刷）')).toBeInTheDocument();
      expect(within(column).getByRole('button', { name: '设置模型' })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('button', { name: '设置模型' })).toHaveLength(2);
  });

  it('点击 Leader「设置模型」打开统一模型弹窗（不是另一套选择器）', () => {
    renderPanel();

    fireEvent.click(
      within(screen.getByTestId('batch-leader')).getByRole('button', { name: '设置模型' }),
    );

    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
    const dialog = dialogs[0];
    expect(within(dialog).getByText('批量设置模型 - Leader 批')).toBeInTheDocument();
    expect(within(dialog).getByText('模型访问与验证说明')).toBeInTheDocument();
    const provider = within(dialog).getByLabelText('Provider');
    const model = within(dialog).getByLabelText('请求模型别名');
    expect(provider.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('选 Provider→Model 保存只刷本地 Leader 行，不调用 updateWorker', async () => {
    renderPanel([option('leader-model-v2', 'provider-a')]);

    fireEvent.click(
      within(screen.getByTestId('batch-leader')).getByRole('button', { name: '设置模型' }),
    );
    const dialog = screen.getByRole('dialog');
    // 选中模型时自动跟随网关绑定的 provider。
    fireEvent.change(within(dialog).getByLabelText('请求模型别名'), {
      target: { value: 'leader-model-v2' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(
      within(screen.getByTestId('batch-leader')).getByText('provider-a · leader-model-v2'),
    ).toBeInTheDocument();
    expect(screen.getByTestId(`member-${LONG_NAME}`)).toHaveTextContent('leader-model-v2');
    expect(screen.getByTestId('member-w1')).toHaveTextContent('w1-model');
    expect(mocks.updateWorkerMutate).not.toHaveBeenCalled();
    expect(mocks.updateWorkerMutateAsync).not.toHaveBeenCalled();

    // 保存成员时才把 model/provider 成对写回该行。
    fireEvent.click(screen.getByTestId('members-save'));
    await waitFor(() =>
      expect(mocks.updateWorkerMutateAsync).toHaveBeenCalledWith({
        name: LONG_NAME,
        data: { model: 'leader-model-v2', modelProvider: 'provider-a' },
      }),
    );
  });

  it('清空选择保存 → 不刷行，摘要回到未设置', async () => {
    renderPanel([option('leader-model-v2', 'provider-a')]);

    fireEvent.click(
      within(screen.getByTestId('batch-leader')).getByRole('button', { name: '设置模型' }),
    );
    fireEvent.change(screen.getByLabelText('请求模型别名'), {
      target: { value: 'leader-model-v2' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(
      within(screen.getByTestId('batch-leader')).getByRole('button', { name: '设置模型' }),
    );
    fireEvent.change(screen.getByLabelText('请求模型别名'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(
      within(screen.getByTestId('batch-leader')).getByText('未设置（留空 = 不刷）'),
    ).toBeInTheDocument();
    // 之前刷过的行保持原值（清空选择 ≠ 把空值刷给所有行）。
    expect(screen.getByTestId(`member-${LONG_NAME}`)).toHaveTextContent('leader-model-v2');
    expect(mocks.updateWorkerMutate).not.toHaveBeenCalled();
  });
});
