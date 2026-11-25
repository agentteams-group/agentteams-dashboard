import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { WorkerCreateDialog } from './worker-create-dialog';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { CreateWorkerRequest } from '@/lib/agentteams-api';
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
    name,
  }: {
    value?: string;
    onValueChange: (_v: string) => void;
    disabled?: boolean;
    children: React.ReactNode;
    name?: string;
  }) => (
    <select aria-label={name === 'worker-model' ? '模型' : undefined} value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectLabel: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/components/dashboard/sections/skills/skill-selector', () => ({
  SkillSelector: () => null,
}));

vi.mock('@/components/dashboard/sections/mcps/mcp-selector', () => ({
  McpSelector: () => null,
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

const renderDialog = (
  value: CreateWorkerRequest = { name: 'worker-1', runtime: 'openclaw' },
  props: Partial<React.ComponentProps<typeof WorkerCreateDialog>> = {},
) => {
  const onChange = vi.fn((_next: unknown) => {});
  const onSubmit = vi.fn(() => {});
  render(
    <TooltipProvider>
      <WorkerCreateDialog
        open
        onOpenChange={() => {}}
        value={value}
        onChange={(next) => onChange(next)}
        isPending={false}
        onSubmit={() => onSubmit()}
        modelOptions={MODEL_OPTIONS}
        {...props}
      />
    </TooltipProvider>,
  );
  return { onChange, onSubmit };
};

function Harness({
  initial,
  onSubmit,
  gatewayMode,
  modelOptions = MODEL_OPTIONS,
}: {
  initial: CreateWorkerRequest;
  onSubmit: (_form: CreateWorkerRequest) => void;
  gatewayMode?: 'direct' | 'external';
  modelOptions?: ModelSelectionOption[];
}) {
  const [value, setValue] = useState<CreateWorkerRequest>(initial);
  return (
    <TooltipProvider>
      <WorkerCreateDialog
        open
        onOpenChange={() => {}}
        value={value}
        onChange={setValue}
        isPending={false}
        onSubmit={() => onSubmit(value)}
        modelOptions={modelOptions}
        gatewayMode={gatewayMode}
      />
    </TooltipProvider>
  );
}

function chooseModel(provider: string, model: string) {
  fireEvent.change(screen.getByLabelText('模型'), {
    target: { value: JSON.stringify([provider, model]) },
  });
}

describe('WorkerCreateDialog grouped model selection', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows one model selector with configured models grouped by connection', () => {
    renderDialog();
    expect(screen.queryByLabelText('模型连接')).toBeNull();
    expect(screen.getByText('provider-a')).toBeInTheDocument();
    expect(screen.getByText('provider-b')).toBeInTheDocument();
    const model = screen.getByLabelText('模型');
    expect(within(model).getByRole('option', { name: 'team-chat' })).toBeInTheDocument();
    expect(within(model).getByRole('option', { name: 'alias-b' })).toBeInTheDocument();
    expect(within(model).queryByRole('option', { name: 'qwen3.6-plus' })).toBeNull();
  });

  it('starts without an implicit connection or model and requires a model selection', () => {
    render(<Harness initial={{ name: 'worker-1', runtime: 'openclaw' }} onSubmit={() => {}} />);
    expect(screen.queryByText('跟随默认连接')).toBeNull();
    expect(screen.queryByText('自动匹配连接')).toBeNull();
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
  });

  it('创建 payload 带 modelProvider（非空）', () => {
    const onSubmit = vi.fn((_form: CreateWorkerRequest) => {});
    render(<Harness initial={{ name: 'worker-1', runtime: 'openclaw' }} onSubmit={onSubmit} />);

    chooseModel('provider-a', 'team-chat');
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      model: 'team-chat',
      modelProvider: 'provider-a',
    });
  });

  it('keeps external gateway requests alias-only while displaying their resolved connection', () => {
    const onSubmit = vi.fn((_form: CreateWorkerRequest) => {});
    render(<Harness gatewayMode="external" initial={{ name: 'worker-1', runtime: 'openclaw' }} onSubmit={onSubmit} />);

    chooseModel('provider-a', 'team-chat');
    expect(screen.getByText('provider-a · team-chat')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].model).toBe('team-chat');
    expect(onSubmit.mock.calls[0][0].modelProvider).toBeUndefined();
  });

  it('switches the connection and model together', () => {
    const onSubmit = vi.fn((_form: CreateWorkerRequest) => {});
    render(
      <Harness
        initial={{ name: 'worker-1', runtime: 'openclaw', model: 'team-chat', modelProvider: 'provider-a' }}
        onSubmit={onSubmit}
      />,
    );

    chooseModel('provider-b', 'alias-b');
    expect(screen.getByText('provider-b · alias-b')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ model: 'alias-b', modelProvider: 'provider-b' });
  });

  it('distinguishes the same model name on different direct connections', () => {
    const onSubmit = vi.fn();
    render(<Harness initial={{ name: 'worker-1', runtime: 'openclaw' }} onSubmit={onSubmit}
      modelOptions={[boundOption('shared-model', 'provider-a'), boundOption('shared-model', 'provider-b')]} />);
    chooseModel('provider-b', 'shared-model');
    expect(screen.getByText('provider-b · shared-model')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ model: 'shared-model', modelProvider: 'provider-b' });
  });

  it('shows all connections for a shared external alias without pretending to pin one', () => {
    const onSubmit = vi.fn();
    render(<Harness gatewayMode="external" initial={{ name: 'worker-1', runtime: 'openclaw' }} onSubmit={onSubmit}
      modelOptions={[boundOption('shared-model', 'provider-a'), boundOption('shared-model', 'provider-b')]} />);
    expect(within(screen.getByLabelText('模型')).getAllByRole('option')).toHaveLength(1);
    chooseModel('provider-a / provider-b', 'shared-model');
    expect(screen.getByText('provider-a / provider-b · shared-model')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(onSubmit.mock.calls[0][0].model).toBe('shared-model');
    expect(onSubmit.mock.calls[0][0].modelProvider).toBeUndefined();
  });

  it('deduplicates the same connection and model returned by multiple routes', () => {
    renderDialog(undefined, { modelOptions: [boundOption('team-chat', 'provider-a'), boundOption('team-chat', 'provider-a')] });
    expect(within(screen.getByLabelText('模型')).getAllByRole('option')).toHaveLength(1);
  });
});

describe('WorkerCreateDialog creation checks', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not offer CoPaw when creating a worker', () => {
    renderDialog();
    expect(screen.queryByRole('option', { name: 'CoPaw' })).toBeNull();
    expect(screen.getByRole('option', { name: 'QwenPaw' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Codex' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'OpenHuman' })).toBeInTheDocument();
    // 运行时推荐与迁移说明都收进 ⓘ，默认视图不展示技术文案。
    expect(screen.getByLabelText('运行时选择说明')).toBeInTheDocument();
    expect(screen.queryByText(/CoPaw 已停止新建/)).not.toBeInTheDocument();
    expect(screen.queryByText('推荐 QwenPaw。')).not.toBeInTheDocument();
  });

  it('新建 Worker 的运行时仍可选（暂禁只针对已有对象）', () => {
    renderDialog();
    const runtimeSelect = screen.getByRole('option', { name: 'Hermes' }).closest('select');
    expect(runtimeSelect).not.toBeDisabled();
    expect(screen.getByRole('option', { name: 'Hermes' })).toBeInTheDocument();
  });

  it('does not silently submit an empty model as the cluster default', () => {
    renderDialog({ name: 'worker-1', runtime: 'openclaw' });
    expect(screen.queryByText(/跟随集群默认/)).toBeNull();
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
  });

  it('accepts a configured model without a force-write step', () => {
    renderDialog({ name: 'worker-1', runtime: 'openclaw', model: 'team-chat' });
    expect(screen.getByText('provider-a · team-chat')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(screen.queryByRole('button', { name: '确认强写' })).toBeNull();
  });

  it('requires an unconfigured draft model to be selected again', () => {
    const { onSubmit } = renderDialog({ name: 'worker-1', runtime: 'openclaw', model: 'custom-x' });
    expect(screen.getByText(/当前模型未在已配置连接中找到/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('offers model management instead of unconfigured built-in models', () => {
    renderDialog(undefined, { modelOptions: [{ alias: 'qwen3.6-plus', kind: 'builtin' }] });
    expect(screen.getByText(/暂无已配置的模型/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '前往模型管理' })).toHaveAttribute('href', '#console/resources/models');
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
  });

  it('does not treat a failed catalog request as an unconfigured connection', () => {
    renderDialog(undefined, { modelOptions: [], sessionIssue: '连接列表加载失败' });
    expect(screen.getByText('连接列表加载失败')).toBeInTheDocument();
    expect(screen.queryByText(/暂无已配置的模型/)).toBeNull();
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
  });

  it('does not submit a stale selection when model configuration cannot be read', () => {
    renderDialog({ name: 'worker-1', runtime: 'openclaw', model: 'team-chat' }, { sessionIssue: '连接列表加载失败' });
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
  });

  it('does not offer malformed names even when returned as configured models', () => {
    renderDialog(undefined, { modelOptions: [boundOption('/models', 'provider-a'), boundOption('team-chat', 'provider-a')] });
    expect(within(screen.getByLabelText('模型')).queryByRole('option', { name: '/models' })).toBeNull();
    expect(within(screen.getByLabelText('模型')).getByRole('option', { name: 'team-chat' })).toBeInTheDocument();
  });

  it('路径形态（/models，9/2 事故值）= ✗ 禁提交', () => {
    renderDialog({ name: 'worker-1', runtime: 'openclaw', model: '/models' });
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
  });

  it('含空格模型名 = ✗ 禁提交', () => {
    renderDialog({ name: 'worker-1', runtime: 'openclaw', model: 'a b' });
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
  });
});

describe('WorkerCreateDialog SOUL 上传（参考插件 📎）', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('.md 文件 → 内容进 soul 字段', async () => {
    const { onChange } = renderDialog();
    const fileInput = document.querySelector('input[type="file"][accept=".md,.txt"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    const file = new File(['# soul\n第二行'], 'soul.md', { type: 'text/markdown' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ soul: '# soul\n第二行' }),
      ),
    );
  });

  it('非 .md/.txt → 拒绝并提示', async () => {
    const { onChange } = renderDialog();
    const fileInput = document.querySelector('input[type="file"][accept=".md,.txt"]') as HTMLInputElement;
    const file = new File(['x'], 'soul.bin', { type: 'application/octet-stream' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText(/仅支持 \.md \/ \.txt/)).toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('超过 150 行 → 行数预算提示（不阻断）', () => {
    const bigSoul = Array.from({ length: 151 }, (_, i) => `line-${i}`).join('\n');
    renderDialog({ name: 'worker-1', runtime: 'openclaw', model: 'team-chat', soul: bigSoul });
    expect(screen.getByText(/SOUL 建议 ≤150 行（当前 151 行）/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建' })).toBeEnabled();
  });
});
