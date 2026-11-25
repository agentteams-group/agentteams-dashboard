import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { DevelopmentSquadDialog } from './development-squad-dialog';
import { deployDevelopmentSquad } from '@/lib/development-squad';
vi.mock('@/lib/development-squad', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/development-squad')>(), deployDevelopmentSquad: vi.fn(),
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe('development squad request dialog', () => {
  it('shows four Codex roles and requires a repository before sending', () => {
    render(<DevelopmentSquadDialog open onOpenChange={() => {}} onRequested={() => {}} />);
    for (const name of ['研发 Leader', '开发工程师', '代码评审工程师', '测试工程师']) expect(screen.getByText(name)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '一键部署' })).toBeDisabled();
    expect(screen.getByText(/四个角色统一使用 Codex/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('留空使用当前集群默认模型')).toBeInTheDocument();
  });
  it('sends a single request on double click and hands off the real Manager receipt', async () => {
    let finish!: (_value: Awaited<ReturnType<typeof deployDevelopmentSquad>>) => void;
    vi.mocked(deployDevelopmentSquad).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const onRequested = vi.fn();
    render(<DevelopmentSquadDialog open onOpenChange={() => {}} onRequested={onRequested} />);
    fireEvent.change(screen.getByLabelText('负责仓库'), { target: { value: 'owner/demo' } });
    fireEvent.change(screen.getByLabelText('统一模型（选填）'), { target: { value: 'qwen3.8-plus' } });
    const button = screen.getByRole('button', { name: '一键部署' });
    fireEvent.click(button); fireEvent.click(button);
    expect(deployDevelopmentSquad).toHaveBeenCalledOnce();
    expect(deployDevelopmentSquad).toHaveBeenCalledWith(expect.objectContaining({ repository: 'owner/demo', model: 'qwen3.8-plus' }));
    expect(screen.queryByText(/Skill 已同步/)).not.toBeInTheDocument();
    const receipt = { teamName: 'dev-team', managerName: 'default', roomId: '!manager:test', eventId: '$sent' };
    finish(receipt);
    await waitFor(() => expect(onRequested).toHaveBeenCalledWith(receipt));
  });
  it('keeps uncertain delivery visible and reuses the request ID on a manual retry', async () => {
    vi.mocked(deployDevelopmentSquad).mockRejectedValue(new Error('delivery unknown'));
    render(<DevelopmentSquadDialog open onOpenChange={() => {}} onRequested={() => {}} />);
    fireEvent.change(screen.getByLabelText('负责仓库'), { target: { value: 'owner/demo' } });
    fireEvent.click(screen.getByRole('button', { name: '一键部署' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('请先查看 Manager 会话'));
    fireEvent.click(screen.getByRole('button', { name: '一键部署' }));
    await waitFor(() => expect(deployDevelopmentSquad).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(deployDevelopmentSquad).mock.calls;
    expect(calls[0][0].requestId).toEqual(calls[1][0].requestId);
  });
});
