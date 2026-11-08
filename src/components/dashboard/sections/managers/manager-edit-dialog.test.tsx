import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { ManagerEditDialog, type ManagerEditForm } from './manager-edit-dialog';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ModelSelectionOption } from '@/lib/model-catalog';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value?: string;
    onValueChange?: (_v: string) => void;
    disabled?: boolean;
    children: React.ReactNode;
  }) => (
    <select
      aria-label="运行时"
      value={value}
      disabled={disabled}
      onChange={(e) => onValueChange?.(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({
    value,
    disabled,
    children,
  }: {
    value: string;
    disabled?: boolean;
    children: React.ReactNode;
  }) => (
    <option value={value} disabled={disabled}>
      {children}
    </option>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
}));

vi.mock('@/components/dashboard/sections/shared/model-selector', () => ({
  ModelSelector: ({
    value,
    onChange,
  }: {
    value?: string;
    onChange: (_v: string) => void;
  }) => (
    <input
      data-testid="model-input"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

const MODEL_OPTIONS: ModelSelectionOption[] = [{ alias: 'team-chat', kind: 'configured' }];

function Harness({
  initial,
  onSubmit,
}: {
  initial: ManagerEditForm;
  onSubmit: (_form: ManagerEditForm) => void;
}) {
  const [value, setValue] = useState<ManagerEditForm>(initial);
  return (
    <TooltipProvider>
      <ManagerEditDialog
        open
        managerName={initial.name ?? 'manager-1'}
        value={value}
        onChange={setValue}
        isPending={false}
        onOpenChange={() => {}}
        onSubmit={() => onSubmit(value)}
        modelOptions={MODEL_OPTIONS}
      />
    </TooltipProvider>
  );
}

const runtimeSelect = () => screen.getByLabelText('运行时') as HTMLSelectElement;

describe('ManagerEditDialog 运行时切换暂禁', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('运行时下拉置灰且保留原值，更新仍提交原 runtime', () => {
    const onSubmit = vi.fn((_form: ManagerEditForm) => {});
    render(<Harness initial={{ name: 'manager-1', runtime: 'qwenpaw' }} onSubmit={onSubmit} />);

    const select = runtimeSelect();
    expect(select).toBeDisabled();
    expect(select.value).toBe('qwenpaw');

    fireEvent.change(select, { target: { value: 'openclaw' } });
    expect(runtimeSelect().value).toBe('qwenpaw');

    fireEvent.click(screen.getByRole('button', { name: '更新' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].runtime).toBe('qwenpaw');
  });

  it('展示「运行时切换暂不可用」说明', () => {
    render(<Harness initial={{ name: 'manager-1', runtime: 'openclaw' }} onSubmit={() => {}} />);
    expect(
      screen.getByText('运行时切换暂不可用（上游运行时适配尚未就绪）'),
    ).toBeInTheDocument();
  });
});
