import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamCreateDialog } from './team-create-dialog';
import { buildWorkerMembers } from '@/lib/agentteams-api';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) => open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

const baseValue = { name: '', leader: { name: 'lead-1' } };

describe('TeamCreateDialog', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('keeps a trailing English comma the user types in the worker input', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TeamCreateDialog open value={baseValue} onChange={onChange} isPending={false} onOpenChange={() => {}} onSubmit={() => {}} workers={[]} />,
    );

    const input = screen.getByPlaceholderText('worker1, worker2 或 worker1，worker2') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'worker1,' } });
    rerender(
      <TeamCreateDialog open value={{ ...baseValue, workerNames: ['worker1'] }} onChange={onChange} isPending={false} onOpenChange={() => {}} onSubmit={() => {}} workers={[]} />,
    );

    expect(input.value).toBe('worker1,');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ workerNames: ['worker1'] }));
  });
});

describe('buildWorkerMembers', () => {
  it('places the leader first as team_leader and dedupes members', () => {
    expect(buildWorkerMembers({ name: 'lead-1' }, ['worker-a', 'lead-1', 'worker-b'])).toEqual([
      { name: 'lead-1', role: 'team_leader' },
      { name: 'worker-a', role: 'worker' },
      { name: 'worker-b', role: 'worker' },
    ]);
  });

  it('returns an empty list when nothing is provided', () => {
    expect(buildWorkerMembers(undefined, undefined)).toEqual([]);
  });
});
