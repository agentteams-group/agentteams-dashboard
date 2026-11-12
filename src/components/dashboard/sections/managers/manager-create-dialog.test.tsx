import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { ManagerCreateDialog } from './manager-create-dialog';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { CreateManagerRequest } from '@/lib/agentteams-api';
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

function Harness({
  initial,
  onSubmit,
}: {
  initial: CreateManagerRequest;
  onSubmit: (_form: CreateManagerRequest) => void;
}) {
  const [value, setValue] = useState<CreateManagerRequest>(initial);
  return (
    <TooltipProvider>
      <ManagerCreateDialog
        open
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

function chooseOption(input: HTMLElement, name: string) {
  fireEvent.focus(input);
  fireEvent.mouseDown(
    within(input.parentElement as HTMLElement).getByRole('option', { name }),
  );
}

const providerInput = () => screen.getByLabelText('Provider');
const modelInput = () => screen.getByLabelText('请求模型别名');

describe('ManagerCreateDialog Provider → Model', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('渲染 Provider 与 Model 两个控件，Provider 在上', () => {
    render(<Harness initial={{ name: 'manager-1' }} onSubmit={() => {}} />);

    const provider = providerInput();
    const model = modelInput();
    expect(
      provider.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('选 Provider 后 Model 候选按 provider 过滤', () => {
    render(<Harness initial={{ name: 'manager-1' }} onSubmit={() => {}} />);

    chooseOption(providerInput(), 'provider-a');
    fireEvent.focus(modelInput());
    const listbox = within(modelInput().parentElement as HTMLElement).getByRole('listbox');
    expect(within(listbox).getByRole('option', { name: 'team-chat' })).toBeInTheDocument();
    expect(within(listbox).queryByRole('option', { name: 'alias-b' })).toBeNull();
  });

  it('创建 payload 带 modelProvider（非空）', () => {
    const onSubmit = vi.fn((_form: CreateManagerRequest) => {});
    render(<Harness initial={{ name: 'manager-1' }} onSubmit={onSubmit} />);

    chooseOption(providerInput(), 'provider-a');
    chooseOption(modelInput(), 'team-chat');
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      model: 'team-chat',
      modelProvider: 'provider-a',
    });
  });

  it('空 Provider = 不带 modelProvider（跟随默认）', () => {
    const onSubmit = vi.fn((_form: CreateManagerRequest) => {});
    render(<Harness initial={{ name: 'manager-1' }} onSubmit={onSubmit} />);

    chooseOption(modelInput(), 'team-chat');
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].modelProvider).toBeUndefined();
  });
});
