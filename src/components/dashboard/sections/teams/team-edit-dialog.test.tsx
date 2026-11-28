import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { TeamEditDialog } from './team-edit-dialog';
import type { WorkerResponse } from '@/lib/agentteams-api';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

// shadcn Select → 原生 select
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange: (_v: string) => void;
    children: React.ReactNode;
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
}));

const worker = (name: string) => ({ name }) as unknown as WorkerResponse;

const renderDialog = (props: {
  value: Parameters<typeof TeamEditDialog>[0]['value'];
  workers?: WorkerResponse[];
}) => {
  const onSubmit = vi.fn(() => {});
  const onChange = vi.fn((_next: unknown) => {});
  render(
    <TeamEditDialog
      open
      teamName="sysdev"
      value={props.value}
      onChange={(next) => onChange(next)}
      isPending={false}
      onOpenChange={() => {}}
      onSubmit={() => onSubmit()}
      workers={props.workers ?? []}
    />,
  );
  return { onSubmit, onChange };
};

describe('TeamEditDialog (plugin parity: members from existing Workers only)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('preserves retired native tuning values when editing a team name', () => {
    const { onChange } = renderDialog({ value: { teamName: 'old', llmMaxRetries: '7', llmStreamIdleTimeout: '45' } });
    expect(screen.queryByText(/LLM 调优默认/)).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('显示名称'), { target: { value: 'new' } });
    expect(onChange).toHaveBeenCalledWith({ teamName: 'new', llmMaxRetries: '7', llmStreamIdleTimeout: '45' });
  });

  it('missing worker (loaded from server) → red warning + save blocked', () => {
    renderDialog({ value: { workerNames: ['ghost-w', 'real-w'] }, workers: [worker('real-w')] });
    expect(screen.getByText(/以下 Worker 不存在/)).toHaveTextContent('ghost-w');
    expect(screen.getByRole('button', { name: '更新' })).toBeDisabled();
  });

  it('ghost chip removal → payload without it (fix-in-place for stale members)', () => {
    const { onChange } = renderDialog({
      value: { workerNames: ['ghost-w', 'real-w'] },
      workers: [worker('real-w')],
    });
    fireEvent.click(screen.getByRole('button', { name: '移除 ghost-w' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ workerNames: ['real-w'] }),
    );
  });

  it('add select offers only existing, unselected workers; select → payload with the added name', () => {
    const { onChange, } = renderDialog({
      value: { workerNames: ['real-w'] },
      workers: [worker('real-w'), worker('real-w2')],
    });
    const addSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    expect(Array.from(addSelect.options).map((o) => o.value)).toEqual(['real-w2']);

    fireEvent.change(addSelect, { target: { value: 'real-w2' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ workerNames: ['real-w', 'real-w2'] }),
    );
  });

  it('all workers exist → save enabled and submits', () => {
    const { onSubmit } = renderDialog({
      value: { workerNames: ['real-w'] },
      workers: [worker('real-w')],
    });
    expect(screen.queryByText(/以下 Worker 不存在/)).toBeNull();
    const save = screen.getByRole('button', { name: '更新' });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onSubmit).toHaveBeenCalled();
  });

  it('empty member list → no warning, save enabled', () => {
    renderDialog({ value: { workerNames: [] }, workers: [worker('real-w')] });
    expect(screen.queryByText(/以下 Worker 不存在/)).toBeNull();
    expect(screen.getByRole('button', { name: '更新' })).toBeEnabled();
  });

  it('no free-text worker input remains', () => {
    renderDialog({ value: { workerNames: [] }, workers: [worker('real-w')] });
    expect(screen.queryByPlaceholderText('worker1, worker2 或 worker1，worker2')).toBeNull();
  });
});
