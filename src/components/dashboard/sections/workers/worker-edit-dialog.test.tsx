import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { WorkerEditDialog, type WorkerEditForm } from './worker-edit-dialog';
import { TooltipProvider } from '@/components/ui/tooltip';
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

vi.mock('@/components/dashboard/sections/skills/skill-selector', () => ({
  SkillSelector: ({ onChange }: { onChange: (_skills: string[]) => void }) => <button onClick={() => onChange([])}>清空技能</button>,
}));

vi.mock('@/components/dashboard/sections/mcps/mcp-selector', () => ({
  McpSelector: () => null,
}));

vi.mock('./worker-gateway-probe', () => ({
  WorkerGatewayProbe: () => null,
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

function Harness({
  initial,
  onSubmit,
  modelProvider,
  basicOnly = false,
}: {
  initial: WorkerEditForm;
  onSubmit: (_form: WorkerEditForm) => void;
  modelProvider?: string;
  basicOnly?: boolean;
}) {
  const [value, setValue] = useState<WorkerEditForm>(initial);
  return (
    <TooltipProvider>
      <WorkerEditDialog
        open
        basicOnly={basicOnly}
        envEditable
        workerName={initial.name ?? 'worker-1'}
        value={value}
        onChange={setValue}
        isPending={false}
        onOpenChange={() => {}}
        onSubmit={() => onSubmit(value)}
        modelOptions={MODEL_OPTIONS}
        modelProvider={modelProvider}
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

const providerInput = () => screen.getByLabelText('模型连接');
const modelInput = () => screen.getByLabelText('模型');

const runtimeSelect = () => screen.getByLabelText('运行时') as HTMLSelectElement;

describe('WorkerEditDialog autonomous checks', () => {
  afterEach(cleanup);

  it('submits an enabled switch without adding environment variables', () => {
    const onSubmit = vi.fn();
    render(<Harness initial={{ runtime: 'openclaw', llmHeartbeatEnabled: false }} onSubmit={onSubmit} />);
    const toggle = screen.getByRole('switch', { name: '自主巡检' });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ llmHeartbeatEnabled: true }));
    expect(onSubmit.mock.calls[0][0].env).toBeUndefined();
  });

  it('preserves an explicit false when disabling a saved enabled switch', () => {
    const onSubmit = vi.fn();
    render(<Harness initial={{ runtime: 'openclaw', llmHeartbeatEnabled: true }} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('switch', { name: '自主巡检' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ llmHeartbeatEnabled: false }));
  });

  it('disables the switch for a Controller that does not return the setting', () => {
    render(<Harness initial={{ runtime: 'openclaw' }} onSubmit={() => {}} />);
    expect(screen.getByRole('switch', { name: '自主巡检' })).toBeDisabled();
  });

  it('does not show an unsupported switch for another runtime', () => {
    render(<Harness initial={{ runtime: 'hermes' }} onSubmit={() => {}} />);
    expect(screen.queryByRole('switch', { name: '自主巡检' })).not.toBeInTheDocument();
  });
});

describe('WorkerEditDialog 运行时交接', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('运行时下拉置灰且保留原值，保存仍提交原 runtime', () => {
    const onSubmit = vi.fn((_form: WorkerEditForm) => {});
    render(<Harness initial={{ name: 'worker-1', runtime: 'qwenpaw' }} onSubmit={onSubmit} />);

    const select = runtimeSelect();
    expect(select).toBeDisabled();
    expect(select.value).toBe('qwenpaw');

    // 禁用态下改值不生效（表单 runtime 保持原值）
    fireEvent.change(select, { target: { value: 'hermes' } });
    expect(runtimeSelect().value).toBe('qwenpaw');

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].runtime).toBe('qwenpaw');
  });

  it('旧 Controller 不开放交接，基础配置仍可保存', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    try {
      render(<Harness initial={{ name: 'worker-1', runtime: 'openclaw' }} onSubmit={() => {}} />);
      expect(await screen.findByText('当前 Controller 未提供此 Worker 的运行时交接。')).toBeInTheDocument();
      expect(runtimeSelect()).toBeDisabled();
      expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('CoPaw 存量保留当前值，避免只保存基础配置就自动切换', () => {
    render(<Harness initial={{ name: 'worker-1', runtime: 'copaw' }} onSubmit={() => {}} />);
    expect(runtimeSelect().value).toBe('copaw');
    expect(screen.getByText(/CoPaw 已停止新建/)).toBeInTheDocument();
  });

  it.each([false, true])('选择目标后仅在保存时切换，并在提交成功前阻止重复保存 (basicOnly=%s)', async (basicOnly) => {
    const idle = { schema_version: 1, kind: 'WorkerRuntimeState' };
    let finishSwitch!: (_response: Response) => void;
    const posts: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'POST') {
        posts.push(init);
        return new Promise<Response>((resolve) => { finishSwitch = resolve; });
      }
      return Response.json(idle);
    }));
    try {
      const save = vi.fn();
      render(<Harness basicOnly={basicOnly} initial={{ name: 'worker-1', runtime: 'codex' }} onSubmit={save} />);
      await waitFor(() => expect(runtimeSelect()).toBeEnabled());
      fireEvent.change(runtimeSelect(), { target: { value: 'qwenpaw' } });
      expect(posts).toHaveLength(0);
      expect(screen.queryByRole('button', { name: '从 Codex 切换到 QwenPaw' })).not.toBeInTheDocument();
      expect(screen.getByText('保存后将停止当前实例，并切换为 QwenPaw。')).toBeInTheDocument();

      const button = screen.getByRole('button', { name: '保存' });
      fireEvent.click(button);
      fireEvent.click(button);
      expect(posts).toHaveLength(1);
      expect(button).toBeDisabled();
      expect(save).not.toHaveBeenCalled();
      finishSwitch(Response.json({ ...idle, handoff: {
        id: JSON.parse(String(posts[0].body)).request_id, phase: 'stopping',
        source: { runtime: 'codex' }, target_runtime: 'qwenpaw',
      } }));
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    } finally { vi.unstubAllGlobals(); }
  });

  it.each(['qwenpaw', 'copaw'] as const)('未修改运行时时只保存基础配置，不发起交接 (%s)', async (runtime) => {
    const fetchMock = vi.fn(async () => Response.json({ schema_version: 1, kind: 'WorkerRuntimeState' }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const save = vi.fn();
      render(<Harness initial={{ name: 'worker-1', runtime }} onSubmit={save} />);
      await waitFor(() => expect(runtimeSelect()).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
      expect(save).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it('目标启动失败后可以在保存时切回原运行时', async () => {
    const failed = { schema_version: 1, kind: 'WorkerRuntimeState', active_start: { runtime: 'codex' },
      handoff: { id: 'old-switch', phase: 'creating', source: { runtime: 'codex' }, target_runtime: 'qwenpaw' },
      target_failure: 'Target Worker is stopped.' };
    const posts: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'POST') {
        posts.push(init);
        return Response.json({ ...failed, target_failure: undefined, handoff: { id: 'new-switch', phase: 'stopping',
          source: { runtime: 'qwenpaw' }, target_runtime: 'codex' } });
      }
      return Response.json(failed, { headers: { ETag: '"failed-version"' } });
    }));
    try {
      const save = vi.fn();
      render(<Harness basicOnly initial={{ name: 'worker-1', runtime: 'qwenpaw' }} onSubmit={save} />);
      await waitFor(() => expect(runtimeSelect()).toBeEnabled());
      expect(runtimeSelect()).toHaveValue('qwenpaw');
      fireEvent.change(runtimeSelect(), { target: { value: 'codex' } });
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      expect(posts).toHaveLength(1);
      expect(JSON.parse(String(posts[0].body))).toEqual({ target_runtime: 'codex', request_id: expect.any(String) });
      expect(posts[0].headers).toMatchObject({ 'If-Match': '"failed-version"' });
    } finally { vi.unstubAllGlobals(); }
  });

  it('切换预检失败时保留弹窗和选择，不继续提交基础配置', async () => {
    const idle = { schema_version: 1, kind: 'WorkerRuntimeState' };
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => init.method === 'POST'
      ? Response.json({ error: 'current Worker start unavailable' }, { status: 503 })
      : Response.json(idle)));
    try {
      const save = vi.fn();
      render(<Harness initial={{ name: 'worker-1', runtime: 'codex' }} onSubmit={save} />);
      await waitFor(() => expect(runtimeSelect()).toBeEnabled());
      fireEvent.change(runtimeSelect(), { target: { value: 'qwenpaw' } });
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('current Worker start unavailable');
      expect(save).not.toHaveBeenCalled();
      expect(runtimeSelect()).toHaveValue('qwenpaw');
      expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('取消编辑时不发起运行时切换', async () => {
    const fetchMock = vi.fn(async () => Response.json({ schema_version: 1, kind: 'WorkerRuntimeState' }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const save = vi.fn();
      render(<Harness initial={{ name: 'worker-1', runtime: 'codex' }} onSubmit={save} />);
      await waitFor(() => expect(runtimeSelect()).toBeEnabled());
      fireEvent.change(runtimeSelect(), { target: { value: 'qwenpaw' } });
      fireEvent.click(screen.getByRole('button', { name: '取消' }));
      expect(fetchMock.mock.calls).toHaveLength(1);
      expect(save).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([null, '"read-version"'])('保存发送条件交接请求，网络重试复用请求编号 (%s)', async (etag) => {
    const idle = { schema_version: 1, kind: 'WorkerRuntimeState' };
    const posts: RequestInit[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'POST') {
        posts.push(init);
        if (posts.length === 1) throw new Error('模拟响应丢失');
        return Response.json({ ...idle, handoff: { id: JSON.parse(String(init.body)).request_id, phase: 'stopping',
          source: { runtime: 'hermes' }, target_runtime: 'qwenpaw' } });
      }
      return Response.json(idle, { headers: etag ? { ETag: etag } : {} });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const save = vi.fn();
      render(<Harness initial={{ name: 'worker-1', runtime: 'hermes' }} onSubmit={save} />);
      await waitFor(() => expect(runtimeSelect()).toBeEnabled());
      fireEvent.change(runtimeSelect(), { target: { value: 'qwenpaw' } });
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
      await screen.findByText('模拟响应丢失');
      expect(save).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: '保存' }));
      await waitFor(() => expect(posts).toHaveLength(2));
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      expect(posts[1].body).toBe(posts[0].body);
      expect(posts[0].headers).toEqual({ 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }) });
      expect(JSON.parse(String(posts[0].body))).toEqual({ target_runtime: 'qwenpaw', request_id: expect.any(String) });
    } finally { vi.unstubAllGlobals(); }
  });

  it('OpenHuman 显示当前运行时且不标为存量', () => {
    render(<Harness initial={{ name: 'worker-1', runtime: 'openhuman' }} onSubmit={() => {}} />);

    expect(runtimeSelect().value).toBe('openhuman');
    expect(screen.getByRole('option', { name: 'OpenHuman' })).toBeInTheDocument();
  });
});

describe('WorkerEditDialog Provider → Model（未改不写回）', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('Provider 在 Model 之前，且显示控制器现值', () => {
    render(
      <Harness
        initial={{ name: 'worker-1', runtime: 'qwenpaw', model: 'team-chat' }}
        modelProvider="provider-a"
        onSubmit={() => {}}
      />,
    );

    const provider = providerInput();
    const model = modelInput();
    expect(provider).toHaveValue('provider-a');
    expect(
      provider.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('Provider 未改 → 表单不带 modelProvider', () => {
    const onSubmit = vi.fn((_form: WorkerEditForm) => {});
    render(
      <Harness
        initial={{ name: 'worker-1', runtime: 'qwenpaw', model: 'team-chat' }}
        modelProvider="provider-a"
        onSubmit={onSubmit}
      />,
    );

    chooseOption(modelInput(), 'team-chat');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].modelProvider).toBeUndefined();
  });

  it('Provider 改后 → 表单一并带上 modelProvider', () => {
    const onSubmit = vi.fn((_form: WorkerEditForm) => {});
    render(
      <Harness
        initial={{ name: 'worker-1', runtime: 'qwenpaw', model: 'team-chat' }}
        modelProvider="provider-a"
        onSubmit={onSubmit}
      />,
    );

    chooseOption(providerInput(), 'provider-b');
    chooseOption(modelInput(), 'alias-b');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      model: 'alias-b',
      modelProvider: 'provider-b',
    });
  });
});

describe('WorkerEditDialog configuration regression', () => {
  afterEach(cleanup);
  it('sends an empty array when the final skill is removed', () => {
    const onSubmit = vi.fn();
    render(<Harness initial={{ skills: ['one'], runtime: 'qwenpaw' }} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText('清空技能'));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ skills: [] }));
  });
  it('keeps MCP and Skills outside the basic configuration form', () => {
    render(<TooltipProvider><WorkerEditDialog open basicOnly workerName="worker" value={{ runtime: 'qwenpaw' }} onChange={() => {}} isPending={false} onOpenChange={() => {}} onSubmit={() => {}} modelOptions={[]} /></TooltipProvider>);
    expect(screen.getByPlaceholderText('容器镜像地址（可选）')).toBeInTheDocument();
    expect(screen.queryByText('清空技能')).not.toBeInTheDocument();
    expect(screen.queryByText('MCP Servers')).not.toBeInTheDocument();
  });
});
