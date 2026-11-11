import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { TeamMembersPanel } from './team-members-panel';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';

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
