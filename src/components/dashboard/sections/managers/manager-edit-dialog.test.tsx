import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

function boundOption(alias: string, providerName: string): ModelSelectionOption {
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

const MODEL_OPTIONS: ModelSelectionOption[] = [
  boundOption('team-chat', 'provider-a'),
  boundOption('alias-b', 'provider-b'),
];

function chooseOption(input: HTMLElement, name: string) {
  fireEvent.focus(input);
  fireEvent.mouseDown(
    within(input.parentElement as HTMLElement).getByRole('option', { name }),
  );
}

const providerInput = () => screen.getByLabelText('Provider');
const modelInput = () => screen.getByLabelText('请求模型别名');

function Harness({
  initial,
  onSubmit,
  modelProvider,
}: {
  initial: ManagerEditForm;
  onSubmit: (_form: ManagerEditForm) => void;
  modelProvider?: string;
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
        modelProvider={modelProvider}
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

describe('ManagerEditDialog Provider → Model（未改不写回）', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('Provider 在 Model 之前，且显示控制器现值', () => {
    render(
      <Harness
        initial={{ name: 'manager-1', runtime: 'qwenpaw', model: 'team-chat' }}
        modelProvider="provider-a"
        onSubmit={() => {}}
      />,
    );

    const provider = providerInput();
    const model = modelInput();
    expect(provider).toHaveValue('provider-a');
    expect(
      provider.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('Provider 未改 → 表单不带 modelProvider', () => {
    const onSubmit = vi.fn((_form: ManagerEditForm) => {});
    render(
      <Harness
        initial={{ name: 'manager-1', runtime: 'qwenpaw', model: 'team-chat' }}
        modelProvider="provider-a"
        onSubmit={onSubmit}
      />,
    );

    chooseOption(modelInput(), 'team-chat');
    fireEvent.click(screen.getByRole('button', { name: '更新' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].modelProvider).toBeUndefined();
  });

  it('Provider 改后 → 表单一并带上 modelProvider', () => {
    const onSubmit = vi.fn((_form: ManagerEditForm) => {});
    render(
      <Harness
        initial={{ name: 'manager-1', runtime: 'qwenpaw', model: 'team-chat' }}
        modelProvider="provider-a"
        onSubmit={onSubmit}
      />,
    );

    chooseOption(providerInput(), 'provider-b');
    chooseOption(modelInput(), 'alias-b');
    fireEvent.click(screen.getByRole('button', { name: '更新' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      model: 'alias-b',
      modelProvider: 'provider-b',
    });
  });
});
