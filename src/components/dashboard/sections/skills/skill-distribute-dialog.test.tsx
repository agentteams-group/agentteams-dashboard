import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SkillDistributeDialog } from './skill-distribute-dialog';

vi.mock('@/hooks/use-agentteams-workers', () => ({
  useWorkers: () => ({ data: [
    { name: 'worker-alpha', status: 'running' },
    { name: 'worker-beta', status: 'stopped' },
  ] }),
}));

vi.mock('@/hooks/use-agentteams-worker-skills', () => ({
  useWorkerSkills: () => ({ data: [] }),
  useUploadWorkerSkill: () => ({
    mutateAsync: vi.fn().mockResolvedValue({
      success: true,
      skillName: 'test-skill',
      description: 'A test skill.',
      filesCount: 1,
      note: 'Worker 最长约 60 秒内自动加载',
      specUpdated: true,
    }),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    data: undefined,
    reset: vi.fn(),
  }),
}));

describe('SkillDistributeDialog', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders title when open', () => {
    render(<SkillDistributeDialog dialogOpen onOpenChange={() => {}} />);
    expect(screen.getByText('向 Worker 分发技能包')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    const { container } = render(<SkillDistributeDialog dialogOpen={false} onOpenChange={() => {}} />);
    expect(container.textContent).toBe('');
  });

  it('shows worker select dropdown with options', () => {
    render(<SkillDistributeDialog dialogOpen onOpenChange={() => {}} />);
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    expect(screen.getByText('worker-alpha')).toBeInTheDocument();
    expect(screen.getByText('worker-beta')).toBeInTheDocument();
  });

  it('shows upload area placeholder when no file selected', () => {
    render(<SkillDistributeDialog dialogOpen onOpenChange={() => {}} />);
    expect(screen.getByText(/拖拽 ZIP 文件到此处/)).toBeInTheDocument();
    expect(screen.getByText(/须包含 SKILL.md/)).toBeInTheDocument();
  });

  it('disables submit when no worker selected', () => {
    render(<SkillDistributeDialog dialogOpen onOpenChange={() => {}} />);
    const submitBtn = screen.getByRole('button', { name: '分发技能' });
    expect(submitBtn).toBeDisabled();
  });

  it('disables submit when no file selected', () => {
    render(<SkillDistributeDialog dialogOpen onOpenChange={() => {}} />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'worker-alpha' } });
    const submitBtn = screen.getByRole('button', { name: '分发技能' });
    expect(submitBtn).toBeDisabled();
  });

  it('shows cancel button', () => {
    render(<SkillDistributeDialog dialogOpen onOpenChange={() => {}} />);
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
  });
});
