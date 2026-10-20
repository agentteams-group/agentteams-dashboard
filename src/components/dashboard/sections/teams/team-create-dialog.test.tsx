import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { TeamCreateDialog, parseWorkerNames } from './team-create-dialog';
import { agentteamsApi, buildWorkerMembers } from '@/lib/agentteams-api';
import type { WorkerResponse } from '@/lib/agentteams-api';
import type { ModelSelectionOption } from '@/lib/model-catalog';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@/lib/agentteams-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agentteams-api')>();
  return {
    ...actual,
    agentteamsApi: { createWorker: vi.fn() },
  };
});

const MODEL_OPTIONS: ModelSelectionOption[] = [
  { alias: 'team-chat', kind: 'configured' },
  { alias: 'qwen3.6-plus', kind: 'builtin' },
];

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) => open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

// shadcn Select → 原生 select（value 可选：MemberPicker 不传 value）
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
  SelectGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
  SelectLabel: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectSeparator: () => null,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
}));

const worker = (name: string, model?: string) =>
  ({ name, model }) as unknown as WorkerResponse;

const renderDialog = (
  value: Parameters<typeof TeamCreateDialog>[0]['value'],
  workers: WorkerResponse[],
) => {
  const onChange = vi.fn((_next: unknown) => {});
  const onWorkerCreated = vi.fn((_name: string) => {});
  const result = render(
    <TooltipProvider>
      <TeamCreateDialog
        open
        value={value}
        onChange={(next) => onChange(next)}
        isPending={false}
        onOpenChange={() => {}}
        onSubmit={() => {}}
        workers={workers}
        modelOptions={MODEL_OPTIONS}
        onWorkerCreated={(name) => onWorkerCreated(name)}
      />
    </TooltipProvider>,
  );
  return { onChange, onWorkerCreated, container: result.container };
};

describe('TeamCreateDialog (plugin parity: members come from existing Workers only)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('no free-text inputs for leader/workers (悬空引用在输入层不可能)', () => {
    renderDialog(
      { name: 't', leader: { name: '' } },
      [worker('lead-1'), worker('real-w')],
    );
    expect(screen.queryByPlaceholderText('leader-name')).toBeNull();
    expect(screen.queryByPlaceholderText('worker1, worker2 或 worker1，worker2')).toBeNull();
  });

  it('leader select offers only existing workers', () => {
    const { container } = renderDialog(
      { name: 't', leader: { name: '' } },
      [worker('lead-1'), worker('real-w', 'qwen')],
    );
    const leaderSelect = container.querySelectorAll('select')[0] as HTMLSelectElement;
    expect(Array.from(leaderSelect.options).map((o) => o.value)).toEqual(['lead-1', 'real-w']);
    // 选项标签 = 名字 + 现用模型（插件 workerOptionLabel 同构）
    expect(Array.from(leaderSelect.options).map((o) => o.textContent)).toEqual([
      'lead-1',
      'real-w（qwen）',
    ]);
  });

  it('leader selection → onChange receives leader name', () => {
    const { onChange, container } = renderDialog(
      { name: 't', leader: { name: '' } },
      [worker('lead-1'), worker('real-w')],
    );
    const leaderSelect = container.querySelectorAll('select')[0] as HTMLSelectElement;
    fireEvent.change(leaderSelect, { target: { value: 'lead-1' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ leader: { name: 'lead-1' } }),
    );
  });

  it('worker picker excludes the leader; select → chip + payload', () => {
    const { onChange, container } = renderDialog(
      { name: 't', leader: { name: 'lead-1' }, workerNames: [] },
      [worker('lead-1'), worker('real-w'), worker('real-w2')],
    );
    // DOM 顺序：Leader / Worker 名单
    const workerPicker = container.querySelectorAll('select')[1] as HTMLSelectElement;
    expect(Array.from(workerPicker.options).map((o) => o.value)).toEqual(['real-w', 'real-w2']);

    // 受控 value：选中只断言 onChange 载荷（chip 渲染依赖父组件回灌 value）
    fireEvent.change(workerPicker, { target: { value: 'real-w' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ workerNames: ['real-w'] }),
    );
  });

  it('no workers at all → hint instead of selects', () => {
    renderDialog({ name: 't', leader: { name: '' } }, []);
    expect(screen.getByText(/暂无 Worker/)).toBeInTheDocument();
  });

  it('name or leader missing → create disabled', () => {
    renderDialog({ name: '', leader: { name: '' } }, [worker('lead-1')]);
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
  });

  it('name + leader set → create enabled', () => {
    renderDialog({ name: 't', leader: { name: 'lead-1' } }, [worker('lead-1')]);
    expect(screen.getByRole('button', { name: '创建' })).toBeEnabled();
  });
});

describe('TeamCreateDialog 内联新建 Worker（9/13 装验反馈：参考插件）', () => {
  const expand = () => fireEvent.click(screen.getByRole('button', { name: /新建 Worker/ }));
  const nameInput = () => screen.getByPlaceholderText('worker-name') as HTMLInputElement;
  const createButton = () => screen.getByRole('button', { name: '创建并加入团队' });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('默认收起：不渲染 Worker 名输入，主路径不受影响', () => {
    renderDialog({ name: 't', leader: { name: 'lead-1' } }, [worker('lead-1')]);
    expect(screen.queryByPlaceholderText('worker-name')).toBeNull();
    expect(screen.getByRole('button', { name: /新建 Worker/ })).toBeInTheDocument();
    // 默认收起 → select 顺序不变（Leader / Worker 名单）
  });

  it('展开 → 填名 → 创建并加入团队：createWorker 载荷 + 入队 + 回调 + 收起', async () => {
    const createWorker = vi
      .mocked(agentteamsApi.createWorker)
      .mockResolvedValue({ name: 'new-w' } as WorkerResponse);
    const { onChange, onWorkerCreated } = renderDialog(
      { name: 't', leader: { name: 'lead-1' } },
      [worker('lead-1')],
    );

    expand();
    expect(createButton()).toBeDisabled();
    fireEvent.change(nameInput(), { target: { value: 'new-w' } });
    expect(createButton()).toBeEnabled();
    fireEvent.click(createButton());

    await waitFor(() =>
      expect(createWorker).toHaveBeenCalledWith({
        name: 'new-w',
        runtime: 'openclaw',
        model: undefined,
        soul: undefined,
      }),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ workerNames: ['new-w'] }),
    );
    expect(onWorkerCreated).toHaveBeenCalledWith('new-w');
    // 成功后收起折叠区并重置表单
    expect(screen.queryByPlaceholderText('worker-name')).toBeNull();
  });

  it('名字已存在为 Worker → 按钮禁用（请从列表选择）', () => {
    renderDialog(
      { name: 't', leader: { name: 'lead-1' } },
      [worker('lead-1'), worker('existing-w')],
    );
    expand();
    fireEvent.change(nameInput(), { target: { value: 'existing-w' } });
    expect(createButton()).toBeDisabled();
  });

  it('名字已在团队 Workers 中 → 按钮禁用', () => {
    renderDialog(
      { name: 't', leader: { name: 'lead-1' }, workerNames: ['team-w'] },
      [worker('lead-1'), worker('team-w')],
    );
    expand();
    fireEvent.change(nameInput(), { target: { value: 'team-w' } });
    expect(createButton()).toBeDisabled();
  });

  it('非法名（短于 3 字符，MinIO 访问密钥长度）→ 按钮禁用', () => {
    renderDialog({ name: 't', leader: { name: 'lead-1' } }, [worker('lead-1')]);
    expand();
    fireEvent.change(nameInput(), { target: { value: 'ab' } });
    expect(createButton()).toBeDisabled();
  });

  it('创建失败 → 显示错误并留在展开态', async () => {
    vi.mocked(agentteamsApi.createWorker).mockRejectedValue(new Error('minio down'));
    renderDialog({ name: 't', leader: { name: 'lead-1' } }, [worker('lead-1')]);
    expand();
    fireEvent.change(nameInput(), { target: { value: 'new-w' } });
    fireEvent.click(createButton());
    await waitFor(() => expect(screen.getByText('minio down')).toBeInTheDocument());
    expect(screen.getByPlaceholderText('worker-name')).toBeInTheDocument();
  });
});

describe('parseWorkerNames', () => {
  it('splits on CN/EN commas and keeps a trailing-comma parse stable', () => {
    expect(parseWorkerNames('worker1,')).toEqual(['worker1']);
    expect(parseWorkerNames('worker1，worker2 , worker3')).toEqual([
      'worker1',
      'worker2',
      'worker3',
    ]);
    expect(parseWorkerNames('')).toEqual([]);
  });
});

describe('buildWorkerMembers', () => {
  it('places the leader first as team_leader and dedupes members', () => {
    expect(buildWorkerMembers({ name: 'lead-1' }, ['worker-a', 'lead-1', 'worker-b'])).toEqual([
      { name: 'lead-1', role: 'team_leader' },
      { name: 'worker-a', role: 'worker' },
      { name: 'worker-b', role: 'worker' },
    ]);
  });

  it('returns an empty list when nothing is provided', () => {
    expect(buildWorkerMembers(undefined, undefined)).toEqual([]);
  });
});
