import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    const provider = screen.getByLabelText('模型连接');
    const model = screen.getByLabelText('模型');
    expect(provider.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(
      within(openList(provider))
        .getAllByRole('option')
        .map((item) => item.textContent),
    ).toEqual(['跟随默认连接', 'provider-a', 'provider-b']);

    expect(
      within(openList(model))
        .getAllByRole('option')
        .map((item) => item.textContent),
    ).toEqual(['alias-b', LONG_ALIAS]);
  });

  it('选择 Provider 后 Model 候选只剩该 Provider 的模型', () => {
    renderDialog();
    const provider = screen.getByLabelText('模型连接');
    fireEvent.click(within(openList(provider)).getByRole('option', { name: 'provider-b' }));

    const model = screen.getByLabelText('模型');
    expect(
      within(openList(model))
        .getAllByRole('option')
        .map((item) => item.textContent),
    ).toEqual(['alias-c']);
  });

  it('换 Provider 时清空不兼容的旧 Model', () => {
    renderDialog();
    const provider = screen.getByLabelText('模型连接');
    fireEvent.click(within(openList(provider)).getByRole('option', { name: 'provider-b' }));
    expect(screen.getByLabelText('模型')).toHaveValue('');
  });

  it('provider 未改（只改 model）→ PUT body 不含 modelProvider', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('模型'), {
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
    fireEvent.change(screen.getByLabelText('模型连接'), { target: { value: 'provider-b' } });
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'alias-c' } });
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
    const model = screen.getByLabelText('模型');
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
    fireEvent.change(screen.getByLabelText('模型'), {
      target: { value: 'alias-b' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('服务器错误 (502): 上游返回了 HTML 页面而非 API 数据');
    expect(alert).not.toHaveTextContent('API Error 502: {"message"');
    // 诊断行只含 model/provider，不含 token。
    expect(alert).toHaveTextContent('"model":"alias-b"');
  });

  it('有 onSave 时进入批量模式：不发 PUT，保存回调并关闭', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    renderDialog({
      title: '批量设置模型 - Leader 批',
      saveLabel: '应用',
      model: 'alias-c',
      modelProvider: 'provider-a',
      onSave,
      onOpenChange,
      onSaved,
    });

    expect(screen.getByText('批量设置模型 - Leader 批')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '应用' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('模型'), {
      target: { value: 'alias-b' },
    });
    fireEvent.click(screen.getByRole('button', { name: '应用' }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ provider: 'provider-a', model: 'alias-b' }),
    );
    expect(mocks.updateWorkerMutate).not.toHaveBeenCalled();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onSaved).toHaveBeenCalledWith({ model: 'alias-b', provider: 'provider-a' });
  });

  it('批量模式保存失败：留在弹窗内显示错误，不关闭', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('批量刷写失败'));
    const onOpenChange = vi.fn();
    renderDialog({ onSave, onOpenChange });

    fireEvent.change(screen.getByLabelText('模型'), {
      target: { value: 'alias-b' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('批量刷写失败');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(mocks.updateWorkerMutate).not.toHaveBeenCalled();
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
