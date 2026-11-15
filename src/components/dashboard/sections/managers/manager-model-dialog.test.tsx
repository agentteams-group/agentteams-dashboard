import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { ManagerModelDialog } from './manager-model-dialog';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ModelSelectionOption } from '@/lib/model-catalog';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
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
  { alias: 'qwen3.6-plus', kind: 'builtin' },
];

function renderDialog({
  model = '',
  modelProvider,
  onSubmit = vi.fn((_model: string, _provider: string) => {}),
}: {
  model?: string;
  modelProvider?: string;
  onSubmit?: (_model: string, _provider: string) => void;
} = {}) {
  render(
    <TooltipProvider>
      <ManagerModelDialog
        open
        managerName="manager-1"
        model={model}
        modelProvider={modelProvider}
        modelOptions={MODEL_OPTIONS}
        saving={false}
        onCancel={() => {}}
        onSubmit={onSubmit}
      />
    </TooltipProvider>,
  );
  return { onSubmit };
}

function chooseOption(input: HTMLElement, name: string) {
  fireEvent.focus(input);
  fireEvent.mouseDown(
    within(input.parentElement as HTMLElement).getByRole('option', { name }),
  );
}

const providerInput = () => screen.getByLabelText('模型连接');
const modelInput = () => screen.getByLabelText('模型');

describe('ManagerModelDialog Provider → Model', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('Provider 在 Model 之前', () => {
    renderDialog();

    const provider = providerInput();
    const model = modelInput();
    expect(
      provider.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('保存调用 onSubmit(model, provider)', () => {
    const { onSubmit } = renderDialog();

    chooseOption(providerInput(), 'provider-a');
    chooseOption(modelInput(), 'team-chat');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('team-chat', 'provider-a');
  });

  it('空 Provider 不带（提交空串，沿用 Controller 现值）', () => {
    const { onSubmit } = renderDialog({ model: 'legacy-model' });

    fireEvent.change(modelInput(), { target: { value: 'qwen3.6-plus' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('qwen3.6-plus', '');
  });

  it('Provider 跟随 alias binding 自动填充并下发（未手选）', () => {
    const { onSubmit } = renderDialog({ model: 'legacy-model' });

    chooseOption(modelInput(), 'alias-b');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('alias-b', 'provider-b');
  });

  it('用户手选 Provider 优先于 binding 自动填充', () => {
    const { onSubmit } = renderDialog({ model: 'legacy-model' });

    // 先选 alias-b → provider 自动跟随 provider-b（未手选）；再手选 provider-a，
    // 模型被清空后按 provider-a 的候选重新选择。
    chooseOption(modelInput(), 'alias-b');
    chooseOption(providerInput(), 'provider-a');
    chooseOption(modelInput(), 'team-chat');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('team-chat', 'provider-a');
  });
});
