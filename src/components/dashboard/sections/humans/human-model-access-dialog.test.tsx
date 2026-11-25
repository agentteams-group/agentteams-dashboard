import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HumanModelAccessDialog } from './human-model-access-dialog';
import { agentteamsApi, type HumanConfigRecord } from '@/lib/agentteams-api';

// 模型候选目录（use-model-selection 单源）：两条带 binding 的 alias + 一条
// 无 binding 的内置 alias（用于验证「无映射 → 模型候选不按 provider 收窄」）。
vi.mock('@/hooks/use-model-selection', () => ({
  useModelSelection: () => ({
    options: [
      {
        alias: 'team-chat',
        kind: 'configured',
        binding: {
          requestModelAlias: 'team-chat',
          routeName: 'chat',
          providerName: 'openai',
          targetModel: 'gpt-4.1',
          available: true,
        },
      },
      {
        alias: 'deep-chat',
        kind: 'configured',
        binding: {
          requestModelAlias: 'deep-chat',
          routeName: 'chat',
          providerName: 'deepseek',
          targetModel: 'deepseek-chat',
          available: true,
        },
      },
      { alias: 'qwen3.5-plus', kind: 'builtin' },
    ],
    providers: [],
    aiRoutes: [],
    isLoading: false,
    sessionIssue: null,
  }),
}));

// Radix Select / Popover 在 jsdom 下需要 ResizeObserver。
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

const RECORD = {
  modelAccess: {
    scopes: [{ role: '', main: { entries: [{ provider: '', model: '' }] } }],
  },
} as unknown as HumanConfigRecord;

function renderDialog() {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  render(
    <HumanModelAccessDialog
      open
      humanName="alice"
      record={RECORD}
      canManage
      onOpenChange={onOpenChange}
      onSaved={onSaved}
    />,
  );
  return { onOpenChange, onSaved };
}

function input(label: string) {
  return screen.getByLabelText(label) as HTMLInputElement;
}

function optionNames() {
  return screen.getAllByRole('option').map((option) => option.textContent);
}

describe('HumanModelAccessDialog · (provider, model) 候选选择', () => {
  beforeEach(() => {
    vi.spyOn(agentteamsApi, 'listModelAccessTables').mockResolvedValue({
      supported: true,
      tables: ['shared-models'],
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('provider 候选来自 binding.providerName（去重排序），仍是可输入框', () => {
    renderDialog();
    const provider = input('provider 1');
    expect(provider.tagName).toBe('INPUT');
    expect(provider).toHaveAttribute('aria-expanded', 'false');

    fireEvent.focus(provider);

    expect(optionNames()).toEqual(['deepseek', 'openai']);
    expect(provider).toHaveAttribute('aria-expanded', 'true');
  });

  it('已填 provider 时模型候选优先筛该 provider；无映射回退全部', () => {
    renderDialog();
    fireEvent.focus(input('provider 1'));
    fireEvent.click(screen.getByRole('option', { name: 'openai' }));

    fireEvent.focus(input('model 1'));
    expect(optionNames()).toEqual(['team-chat']);

    // 未配置映射的 provider → 全部 alias（不把用户锁死在空候选里）。
    fireEvent.blur(input('model 1'));
    fireEvent.change(input('provider 1'), { target: { value: 'legacy-provider' } });
    fireEvent.focus(input('model 1'));
    expect(optionNames()).toEqual(['deep-chat', 'qwen3.5-plus', 'team-chat']);
  });

  it('选择 model 时按 binding 反查自动补 provider', () => {
    renderDialog();
    fireEvent.focus(input('model 1'));
    fireEvent.click(screen.getByRole('option', { name: 'deep-chat' }));

    expect(input('model 1')).toHaveValue('deep-chat');
    expect(input('provider 1')).toHaveValue('deepseek');
  });

  it('已填 provider 不被 model 反查覆盖', () => {
    renderDialog();
    fireEvent.change(input('provider 1'), { target: { value: 'custom-provider' } });
    fireEvent.focus(input('model 1'));
    fireEvent.click(screen.getByRole('option', { name: 'team-chat' }));

    expect(input('provider 1')).toHaveValue('custom-provider');
    expect(input('model 1')).toHaveValue('team-chat');
  });

  it('保留自由输入：手填不在候选里的 (provider, model) 可保存', async () => {
    const save = vi.spyOn(agentteamsApi, 'saveHumanModelAccess').mockResolvedValue({
      ok: true,
      method: 'PUT',
    } as Awaited<ReturnType<typeof agentteamsApi.saveHumanModelAccess>>);
    const { onSaved } = renderDialog();

    fireEvent.change(input('provider 1'), { target: { value: 'my-provider' } });
    fireEvent.change(input('model 1'), { target: { value: 'my-model' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save).toHaveBeenCalledWith('alice', {
      scopes: [{ main: { entries: [{ provider: 'my-provider', model: 'my-model' }] } }],
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('空值清空：清掉 model 后不完整行红字提示复现', () => {
    renderDialog();
    fireEvent.change(input('model 1'), { target: { value: 'team-chat' } });
    expect(screen.queryByText('provider 与 model 需成对填写')).toBeNull();

    fireEvent.change(input('model 1'), { target: { value: '' } });

    expect(input('model 1')).toHaveValue('');
    expect(screen.getByText('provider 与 model 需成对填写')).toBeInTheDocument();
  });

  it('不完整行拦截保存，行内红字 + 汇总提示同时出现', () => {
    renderDialog();
    fireEvent.change(input('provider 1'), { target: { value: 'openai' } });

    expect(screen.getByText('provider 与 model 需成对填写')).toBeInTheDocument();
    expect(screen.getByText(/1 行 \(provider, model\) 不完整/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  });

  it('作用域 role / 共享表仍是 Select（button + role=combobox），不是裸 Input', () => {
    renderDialog();
    for (const label of ['作用域 1 角色', '作用域 1 共享表']) {
      const control = screen.getByLabelText(label);
      expect(control.tagName).toBe('BUTTON');
      expect(control).toHaveAttribute('role', 'combobox');
    }
  });
});
