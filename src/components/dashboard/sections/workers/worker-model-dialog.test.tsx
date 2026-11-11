import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { WorkerModelDialog } from './worker-model-dialog';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ModelSelectionOption } from '@/lib/model-catalog';

const mocks = vi.hoisted(() => ({ updateWorkerMutate: vi.fn() }));

vi.mock('@/hooks/use-agentteams-mutations', () => ({
  useUpdateWorker: () => ({ mutate: mocks.updateWorkerMutate, isPending: false }),
}));

// Radix Select 打开时用 ResizeObserver 量触发按钮宽度。
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

// 最长 alias + 最长 route 描述：编辑模型弹窗此前被 SelectTrigger 的
// min-content 宽度撑出 max-w-md 白卡片（横向溢出），这里钉住收敛类。
const LONG_ALIAS = `team-chat-${'very-long-alias-'.repeat(4)}alias`;
const options: ModelSelectionOption[] = [
  {
    alias: LONG_ALIAS,
    kind: 'configured',
    binding: {
      requestModelAlias: LONG_ALIAS,
      routeName: `route-${'segment-'.repeat(6)}name`,
      providerName: `provider-${'segment-'.repeat(5)}name`,
      targetModel: `model-${'segment-'.repeat(6)}name`,
      available: true,
    },
  },
];

describe('WorkerModelDialog 弹窗溢出收口', () => {
  afterEach(cleanup);

  function renderDialog() {
    render(
      <TooltipProvider>
        <WorkerModelDialog
          open
          workerName="worker-with-a-long-name"
          model={LONG_ALIAS}
          providerHint="higress.internal.example-provider"
          modelOptions={options}
          onOpenChange={() => {}}
        />
      </TooltipProvider>,
    );
  }

  it('SelectTrigger 收敛宽度，长 alias 不撑开弹窗', () => {
    renderDialog();

    // 模型选择仍是 Select（role=combobox）；Provider 已换成可输入 Combobox，
    // 这里按 aria-label 精确定位模型选择触发按钮。
    const trigger = screen.getByLabelText('请求模型别名');
    expect(trigger.className).toContain('w-full');
    expect(trigger.className).toContain('min-w-0');
  });

  it('Provider 输入框占满可用宽度', () => {
    renderDialog();

    const input = screen.getByPlaceholderText(/当前解析/);
    expect(input.className).toContain('w-full');
    expect(input.className).toContain('min-w-0');
  });

  it('Provider 候选来自模型绑定，且仍可自由输入', () => {
    renderDialog();
    const provider = screen.getByPlaceholderText(/当前解析/) as HTMLInputElement;

    fireEvent.focus(provider);
    expect(
      within(screen.getByRole('listbox'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([options[0].binding?.providerName]);

    fireEvent.change(provider, { target: { value: 'legacy-provider' } });
    expect(provider).toHaveValue('legacy-provider');
  });

  it('DialogContent 无固定像素宽度且带横向防溢出兜底', () => {
    renderDialog();

    const content = document.querySelector('[data-slot="dialog-content"]');
    expect(content).not.toBeNull();
    const className = content?.className ?? '';
    expect(className).toContain('overflow-x-hidden');
    expect(className).toContain('overflow-y-auto');
    expect(className).toContain('min-w-0');
    expect(className).toContain('sm:max-w-md');
    expect(className).not.toMatch(/(?<![\w-])(?:[a-z-]+:)?w-\[\d+px\]/);
  });

  it('选模型后自动跟随 provider，保存时成对下发', () => {
    mocks.updateWorkerMutate.mockReset();
    render(
      <TooltipProvider>
        <WorkerModelDialog
          open
          workerName="w1"
          model=""
          providerHint="higress.internal.example-provider"
          modelOptions={options}
          onOpenChange={() => {}}
        />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByLabelText('请求模型别名'));
    fireEvent.click(screen.getByRole('option', { name: new RegExp(LONG_ALIAS) }));

    const provider = screen.getByPlaceholderText(/当前解析/) as HTMLInputElement;
    expect(provider.value).toBe(options[0].binding?.providerName);

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(mocks.updateWorkerMutate).toHaveBeenCalledWith(
      {
        name: 'w1',
        data: { model: LONG_ALIAS, modelProvider: options[0].binding?.providerName },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
