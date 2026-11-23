import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { DevelopmentSquadDialog } from './development-squad-dialog';
import { deployDevelopmentSquad } from '@/lib/development-squad';

vi.mock('@/lib/development-squad', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/development-squad')>(), deployDevelopmentSquad: vi.fn(),
}));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('development squad dialog', () => {
  it('shows all four roles, their assets and the inherited model without a model form', () => {
    render(<DevelopmentSquadDialog open onOpenChange={() => {}} onDeployed={() => {}} />);
    expect(screen.getByText('跟随集群默认模型')).toBeInTheDocument();
    for (const name of ['研发 Leader', '开发工程师', '代码评审工程师', '测试工程师']) expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.getByText('dev-squad-developer')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
  it('prevents a double click and reports configuration completion without claiming readiness', async () => {
    let finish!: (_value: Awaited<ReturnType<typeof deployDevelopmentSquad>>) => void;
    vi.mocked(deployDevelopmentSquad).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const onDeployed = vi.fn();
    render(<DevelopmentSquadDialog open onOpenChange={() => {}} onDeployed={onDeployed} />);
    const button = screen.getByRole('button', { name: '一键部署' });
    fireEvent.click(button); fireEvent.click(button);
    expect(deployDevelopmentSquad).toHaveBeenCalledTimes(1);
    finish({ teamName: 'dev-team', workerNames: ['dev-team-leader'], skillNames: ['dev-squad-leader'] });
    await waitFor(() => expect(onDeployed).toHaveBeenCalledOnce());
    expect(screen.getByText(/启动进度见小队列表/)).toBeInTheDocument();
    expect(screen.queryByText('全部 Agent 已就绪')).not.toBeInTheDocument();
  });
  it('keeps failures visible and allows a same-name retry', async () => {
    vi.mocked(deployDevelopmentSquad).mockRejectedValue(new Error('资产存储不可用'));
    render(<DevelopmentSquadDialog open onOpenChange={() => {}} onDeployed={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '一键部署' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('资产存储不可用'));
    fireEvent.click(screen.getByRole('button', { name: '重试部署' }));
    await waitFor(() => expect(deployDevelopmentSquad).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('小队标识')).toHaveValue('dev-team');
  });
});
