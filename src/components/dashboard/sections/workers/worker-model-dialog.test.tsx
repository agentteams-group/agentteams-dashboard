import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import '@testing-library/jest-dom/vitest';
import { WorkerModelDialog } from './worker-model-dialog';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ApiError } from '@/lib/api-error';
import type { ModelSelectionOption } from '@/lib/model-catalog';

const mocks = vi.hoisted(() => ({ updateWorkerMutate: vi.fn() }));

vi.mock('@/hooks/use-agentteams-mutations', () => ({
  useUpdateWorker: () => ({ mutate: mocks.updateWorkerMutate, isPending: false }),
}));

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

const LONG_ALIAS = `team-chat-${'very-long-alias-'.repeat(4)}alias`;

function option(alias: string, providerName: string): ModelSelectionOption {
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

const options: ModelSelectionOption[] = [
  option(LONG_ALIAS, 'provider-a'),
  option('alias-b', 'provider-a'),
  option('alias-c', 'provider-b'),
];

function openList(input: HTMLElement): HTMLElement {
  fireEvent.focus(input);
  return within(input.parentElement as HTMLElement).getByRole('listbox');
}

function renderDialog(props: Partial<ComponentProps<typeof WorkerModelDialog>> = {}) {
  return render(
    <TooltipProvider>
      <WorkerModelDialog
        open
        workerName="worker-with-a-long-name"
        model={LONG_ALIAS}
        modelProvider="provider-a"
        providerHint="provider-a"
        modelOptions={options}
        onOpenChange={() => {}}
        {...props}
      />
    </TooltipProvider>,
  );
}

describe('WorkerModelDialog', () => {
  afterEach(() => {
    cleanup();
    mocks.updateWorkerMutate.mockReset();
  });

  it('Provider 在上、Model 在下，两个都有候选下拉', () => {
    renderDialog();
    const provider = screen.getByLabelText('Provider');
    const model = screen.getByLabelText('请求模型别名');
    expect(provider.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(
      within(openList(provider))
        .getAllByRole('option')
        .map((item) => item.textContent),
    ).toEqual(['无 Provider（在服 + 在用）', 'provider-a', 'provider-b']);

    expect(
      within(openList(model))
        .getAllByRole('option')
        .map((item) => item.textContent),
    ).toEqual(['alias-b', LONG_ALIAS]);
  });

  it('选择 Provider 后 Model 候选只剩该 Provider 的模型', () => {
    renderDialog();
    const provider = screen.getByLabelText('Provider');
    fireEvent.click(within(openList(provider)).getByRole('option', { name: 'provider-b' }));

    const model = screen.getByLabelText('请求模型别名');
    expect(
      within(openList(model))
        .getAllByRole('option')
        .map((item) => item.textContent),
    ).toEqual(['alias-c']);
  });

  it('换 Provider 时清空不兼容的旧 Model', () => {
    renderDialog();
    const provider = screen.getByLabelText('Provider');
    fireEvent.click(within(openList(provider)).getByRole('option', { name: 'provider-b' }));
    expect(screen.getByLabelText('请求模型别名')).toHaveValue('');
  });

  it('provider 未改（只改 model）→ PUT body 不含 modelProvider', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('请求模型别名'), {
      target: { value: 'alias-b' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(mocks.updateWorkerMutate).toHaveBeenCalledWith(
      {
        name: 'worker-with-a-long-name',
        data: { model: 'alias-b' },
      },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('provider 真变化 → PUT body 成对带 modelProvider', () => {
    renderDialog({ model: 'alias-c', modelProvider: 'provider-a' });
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'provider-b' } });
    fireEvent.change(screen.getByLabelText('请求模型别名'), { target: { value: 'alias-c' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(mocks.updateWorkerMutate).toHaveBeenCalledWith(
      {
        name: 'worker-with-a-long-name',
        data: { model: 'alias-c', modelProvider: 'provider-b' },
      },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('无初始 provider 时选模型自动跟随绑定 provider 并成对下发', () => {
    renderDialog({ model: '', modelProvider: undefined, providerHint: undefined });
    const model = screen.getByLabelText('请求模型别名');
    fireEvent.click(within(openList(model)).getByRole('option', { name: LONG_ALIAS }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(mocks.updateWorkerMutate).toHaveBeenCalledWith(
      {
        name: 'worker-with-a-long-name',
        data: { model: LONG_ALIAS, modelProvider: 'provider-a' },
      },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('502 时弹窗内显示服务端 message，而不是裸 API Error', () => {
    mocks.updateWorkerMutate.mockImplementation((_variables, callbacks) => {
      callbacks?.onError?.(
        new ApiError(
          'API Error 502: {"message":"上游返回了 HTML 页面而非 API 数据","upstream_status":502}',
          502,
          '/workers/worker-with-a-long-name',
        ),
      );
    });
    renderDialog();
    fireEvent.change(screen.getByLabelText('请求模型别名'), {
      target: { value: 'alias-b' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('服务器错误 (502): 上游返回了 HTML 页面而非 API 数据');
    expect(alert).not.toHaveTextContent('API Error 502: {"message"');
    // 诊断行只含 model/provider，不含 token。
    expect(alert).toHaveTextContent('"model":"alias-b"');
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
  });
});
