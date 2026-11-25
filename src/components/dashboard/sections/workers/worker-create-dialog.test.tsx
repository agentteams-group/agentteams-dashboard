import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { WorkerCreateDialog } from './worker-create-dialog';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { CreateWorkerRequest } from '@/lib/agentteams-api';
import type { ModelSelectionOption } from '@/lib/model-catalog';

const gateway = vi.hoisted(() => ({ mode: 'direct' as 'direct' | 'external' | undefined, isLoading: false }));
vi.mock('@/hooks/use-agentteams-infrastructure', () => ({
  useInfrastructure: () => ({ data: gateway.mode ? { higress: { mode: gateway.mode } } : undefined, isLoading: gateway.isLoading }),
}));
afterEach(() => { gateway.mode = 'direct'; gateway.isLoading = false; });

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
    <select aria-label={name === 'worker-model' ? '模型' : name === 'worker-model-connection' ? '模型连接' : undefined} value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>
      <option value="" />
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
  modelOptions = MODEL_OPTIONS,
}: {
  initial: CreateWorkerRequest;
  onSubmit: (_form: CreateWorkerRequest) => void;
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
      />
    </TooltipProvider>
  );
}

function chooseModel(provider: string, model: string) {
  fireEvent.change(screen.getByLabelText('模型连接'), { target: { value: provider } });
  fireEvent.change(screen.getByLabelText('模型'), {
    target: { value: model },
  });
}

describe('WorkerCreateDialog connection then model selection', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('requires a connection before showing only its configured models', () => {
    render(<Harness initial={{ name: 'worker-1', runtime: 'openclaw' }} onSubmit={() => {}} />);
    const connection = screen.getByLabelText('模型连接');
    expect(within(connection).getByRole('option', { name: 'provider-a' })).toBeInTheDocument();
    expect(within(connection).getByRole('option', { name: 'provider-b' })).toBeInTheDocument();
    const model = screen.getByLabelText('模型');
    expect(model).toBeDisabled();
    fireEvent.change(connection, { target: { value: 'provider-a' } });
    expect(model).toBeEnabled();
    expect(within(model).getByRole('option', { name: 'team-chat' })).toBeInTheDocument();
    expect(within(model).queryByRole('option', { name: 'alias-b' })).toBeNull();
    expect(within(model).queryByRole('option', { name: 'qwen3.6-plus' })).toBeNull();
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
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
    gateway.mode = 'external';
    const onSubmit = vi.fn((_form: CreateWorkerRequest) => {});
    render(<Harness initial={{ name: 'worker-1', runtime: 'openclaw' }} onSubmit={onSubmit} />);

    chooseModel('provider-a', 'team-chat');
    expect(screen.getByLabelText('模型连接')).toHaveValue('provider-a');
    expect(screen.getByLabelText('模型')).toHaveValue('team-chat');
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].model).toBe('team-chat');
    expect(onSubmit.mock.calls[0][0].modelProvider).toBeUndefined();
  });

  it('clears the model when switching connections and requires a new selection', () => {
    const onSubmit = vi.fn((_form: CreateWorkerRequest) => {});
    render(
      <Harness
        initial={{ name: 'worker-1', runtime: 'openclaw', model: 'team-chat', modelProvider: 'provider-a' }}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText('模型连接'), { target: { value: 'provider-b' } });
    expect(screen.getByLabelText('模型')).toHaveValue('');
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
    expect(within(screen.getByLabelText('模型')).queryByRole('option', { name: 'team-chat' })).toBeNull();
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'alias-b' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ model: 'alias-b', modelProvider: 'provider-b' });
  });

  it('distinguishes the same model name on different direct connections', () => {
    const onSubmit = vi.fn();
    render(<Harness initial={{ name: 'worker-1', runtime: 'openclaw' }} onSubmit={onSubmit}
      modelOptions={[boundOption('shared-model', 'provider-a'), boundOption('shared-model', 'provider-b')]} />);
    chooseModel('provider-b', 'shared-model');
    expect(screen.getByLabelText('模型连接')).toHaveValue('provider-b');
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ model: 'shared-model', modelProvider: 'provider-b' });
  });

  it('requires selecting the model again even when both connections offer the same alias', () => {
    render(<Harness initial={{ name: 'worker-1', runtime: 'openclaw', model: 'shared-model', modelProvider: 'provider-a' }} onSubmit={() => {}}
      modelOptions={[boundOption('shared-model', 'provider-a'), boundOption('shared-model', 'provider-b')]} />);
    fireEvent.change(screen.getByLabelText('模型连接'), { target: { value: 'provider-b' } });
    expect(screen.getByLabelText('模型')).toHaveValue('');
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
  });

  it('does not infer a direct connection from a prefilled model alias', () => {
    renderDialog({ name: 'worker-1', runtime: 'openclaw', model: 'team-chat' });
    expect(screen.getByLabelText('模型连接')).toHaveValue('');
    expect(screen.getByLabelText('模型')).toBeDisabled();
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
  });

  it('shows all connections for a shared external alias without pretending to pin one', () => {
    gateway.mode = 'external';
    const onSubmit = vi.fn();
    render(<Harness initial={{ name: 'worker-1', runtime: 'openclaw' }} onSubmit={onSubmit}
      modelOptions={[boundOption('shared-model', 'provider-a'), boundOption('shared-model', 'provider-b')]} />);
    chooseModel('provider-a / provider-b', 'shared-model');
    expect(screen.getByLabelText('模型连接')).toHaveValue('provider-a / provider-b');
    expect(screen.getByText(/由外部网关按模型路由分配/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(onSubmit.mock.calls[0][0].model).toBe('shared-model');
    expect(onSubmit.mock.calls[0][0].modelProvider).toBeUndefined();
  });

  it('deduplicates the same connection and model returned by multiple routes', () => {
    renderDialog({ name: 'worker-1', runtime: 'openclaw', modelProvider: 'provider-a' }, { modelOptions: [boundOption('team-chat', 'provider-a'), boundOption('team-chat', 'provider-a')] });
    expect(within(screen.getByLabelText('模型连接')).getAllByRole('option', { name: 'provider-a' })).toHaveLength(1);
    expect(within(screen.getByLabelText('模型')).getAllByRole('option', { name: 'team-chat' })).toHaveLength(1);
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
    renderDialog({ name: 'worker-1', runtime: 'openclaw', model: 'team-chat', modelProvider: 'provider-a' });
    expect(screen.getByLabelText('模型')).toHaveValue('team-chat');
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(screen.queryByRole('button', { name: '确认强写' })).toBeNull();
  });

  it('requires an unconfigured draft model to be selected again', () => {
    const { onSubmit } = renderDialog({ name: 'worker-1', runtime: 'openclaw', model: 'custom-x' });
    expect(screen.getByText(/请先选择模型连接，再选择该连接下的模型/)).toBeInTheDocument();
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

  it('waits for gateway mode instead of sending a provider before it is known', () => {
    gateway.mode = undefined;
    gateway.isLoading = true;
    renderDialog({ name: 'worker-1', runtime: 'openclaw', model: 'team-chat' });
    expect(screen.getByText('正在读取模型连接设置，请稍候。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
  });

  it('reports an unavailable gateway mode without treating it as an empty model catalog', () => {
    gateway.mode = undefined;
    renderDialog();
    expect(screen.getByText('无法读取模型连接设置，请稍后重试。')).toBeInTheDocument();
    expect(screen.queryByText(/暂无已配置的模型/)).toBeNull();
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
  });

  it('shows loading rather than an empty model directory while catalog requests are pending', () => {
    renderDialog(undefined, { modelOptions: [], modelsLoading: true });
    expect(screen.getByText('正在加载模型列表，请稍候。')).toBeInTheDocument();
    expect(screen.queryByText(/暂无已配置的模型/)).toBeNull();
  });

  it('does not offer malformed names even when returned as configured models', () => {
    renderDialog({ name: 'worker-1', runtime: 'openclaw', modelProvider: 'provider-a' }, { modelOptions: [boundOption('/models', 'provider-a'), boundOption('team-chat', 'provider-a')] });
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
    renderDialog({ name: 'worker-1', runtime: 'openclaw', model: 'team-chat', modelProvider: 'provider-a', soul: bigSoul });
    expect(screen.getByText(/SOUL 建议 ≤150 行（当前 151 行）/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建' })).toBeEnabled();
  });
});
