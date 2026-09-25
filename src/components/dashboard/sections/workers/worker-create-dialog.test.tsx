import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { WorkerCreateDialog } from './worker-create-dialog';
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
    children,
  }: {
    value?: string;
    onValueChange: (_v: string) => void;
    children: React.ReactNode;
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
}));

vi.mock('@/components/dashboard/sections/shared/model-selector', () => ({
  ModelSelector: ({
    value,
    onChange,
    placeholder,
  }: {
    value?: string;
    onChange: (_v: string) => void;
    placeholder?: string;
  }) => (
    <input
      data-testid="model-input"
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

vi.mock('@/components/dashboard/sections/skills/skill-selector', () => ({
  SkillSelector: () => null,
}));

vi.mock('@/components/dashboard/sections/mcps/mcp-selector', () => ({
  McpSelector: () => null,
}));

const MODEL_OPTIONS: ModelSelectionOption[] = [
  { alias: 'team-chat', kind: 'configured' },
  { alias: 'qwen3.6-plus', kind: 'builtin' },
];

const renderDialog = (
  value: CreateWorkerRequest = { name: 'worker-1', runtime: 'openclaw' },
) => {
  const onChange = vi.fn((_next: unknown) => {});
  const onSubmit = vi.fn(() => {});
  render(
    <WorkerCreateDialog
      open
      onOpenChange={() => {}}
      value={value}
      onChange={(next) => onChange(next)}
      isPending={false}
      onSubmit={() => onSubmit()}
      modelOptions={MODEL_OPTIONS}
    />,
  );
  return { onChange, onSubmit };
};

describe('WorkerCreateDialog 模型写前校验（9/13 装验反馈：参考插件 G2）', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not offer CoPaw when creating a worker', () => {
    renderDialog();
    expect(screen.queryByRole('option', { name: 'CoPaw' })).toBeNull();
    expect(screen.getByRole('option', { name: 'QwenPaw' })).toBeInTheDocument();
    expect(screen.getByText(/CoPaw 已停止新建/)).toBeInTheDocument();
  });

  it('留空 = 跟随集群默认（✓，不拦提交）', () => {
    renderDialog({ name: 'worker-1', runtime: 'openclaw' });
    expect(screen.getByText(/跟随集群默认/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建' })).toBeEnabled();
  });

  it('命中 alias 组 = ✓', () => {
    renderDialog({ name: 'worker-1', runtime: 'openclaw', model: 'team-chat' });
    expect(screen.getByText(/命中 alias 组/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    // 命中 → 直接提交，不弹强写确认
    expect(screen.queryByRole('button', { name: '确认强写' })).toBeNull();
  });

  it('未命中 alias 组 = ⚠ 两步确认强写', async () => {
    const { onSubmit } = renderDialog({ name: 'worker-1', runtime: 'openclaw', model: 'custom-x' });
    expect(screen.getByText(/未命中 alias 组/)).toBeInTheDocument();

    // 第一次点击 → 只弹确认条，不提交
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '确认强写' })).toBeInTheDocument();

    // 确认强写 → 提交
    fireEvent.click(screen.getByRole('button', { name: '确认强写' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('返回修改 → 关闭确认条，不提交', () => {
    const { onSubmit } = renderDialog({ name: 'worker-1', runtime: 'openclaw', model: 'custom-x' });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    fireEvent.click(screen.getByRole('button', { name: '返回修改' }));
    expect(screen.queryByRole('button', { name: '确认强写' })).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('路径形态（/models，9/2 事故值）= ✗ 禁提交', () => {
    renderDialog({ name: 'worker-1', runtime: 'openclaw', model: '/models' });
    expect(screen.getByText(/模型名不能是路径\/URL 或含空格/)).toBeInTheDocument();
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
    renderDialog({ name: 'worker-1', runtime: 'openclaw', soul: bigSoul });
    expect(screen.getByText(/SOUL 建议 ≤150 行（当前 151 行）/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建' })).toBeEnabled();
  });
});
