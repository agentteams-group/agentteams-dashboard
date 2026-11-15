'use client';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LlmProviderResponse } from '@/lib/higress-api';
import { ModelsSection } from './models-section';
import { TooltipProvider } from '@/components/ui/tooltip';

const mutations = {
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
  createRoute: vi.fn(),
  updateRoute: vi.fn(),
  deleteRoute: vi.fn(),
  createConsumer: vi.fn(),
  bindConsumer: vi.fn(),
};

const providers: LlmProviderResponse[] = [
  { name: 'openai', type: 'openai', protocol: 'openai/v1', tokenCount: 1 },
  { name: 'deepseek', type: 'deepseek', protocol: 'openai/v1', tokenCount: 1 },
];
const routes = [{
  name: 'team-chat',
  pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
  upstreams: [{ provider: 'openai', weight: 100, modelMapping: { 'team-chat': 'gpt-4.1' } }],
  modelPredicates: [{ matchType: 'EXACT', matchValue: 'team-chat' }],
  authConfig: { enabled: true, allowedCredentialTypes: ['key-auth'] },
  fallbackConfigWritable: true,
}];

const { mockRouteOverrides } = vi.hoisted(() => ({ mockRouteOverrides: { value: undefined as unknown } }));

vi.mock('@/hooks/use-agentteams-models', () => ({
  useModels: () => ({ data: providers, isLoading: false, error: null }),
  useAiRoutes: () => ({ data: mockRouteOverrides.value ?? routes, isLoading: false, error: null }),
  useCreateModel: () => ({ mutate: mutations.createProvider, isPending: false }),
  useUpdateModel: () => ({ mutate: mutations.updateProvider, isPending: false }),
  useDeleteModel: () => ({ mutate: mutations.deleteProvider, isPending: false, isError: false }),
  useCreateAiRoute: () => ({ mutate: mutations.createRoute, isPending: false }),
  useUpdateAiRoute: () => ({ mutate: mutations.updateRoute, isPending: false }),
  useDeleteAiRoute: () => ({ mutate: mutations.deleteRoute, isPending: false, isError: false }),
}));

vi.mock('@/hooks/use-agentteams-managers', () => ({ useManagers: () => ({ data: [{ model: 'team-chat' }] }) }));
vi.mock('@/hooks/use-agentteams-workers', () => ({ useWorkers: () => ({ data: [] }) }));
vi.mock('@/hooks/use-higress-console-access', () => ({ useHigressConsoleAccess: () => ({ canManage: true, isLoading: false }) }));
vi.mock('@/hooks/use-agentteams-infrastructure', () => ({
  useInfrastructure: () => ({
    data: {
      higress: {
        mode: 'external',
        gateway: { state: 'reachable', endpoint: 'http://aigw-local.agentteams.io:8080' },
        console: { state: 'reachable', endpoint: 'http://console.local' },
        healthy: true,
      },
      services: [],
    },
    isLoading: false,
    error: null,
  }),
}));
vi.mock('@/hooks/use-agentteams-consumers', () => ({
  useConsumers: () => ({ data: [{ name: 'web-crawler', status: 'active' }], isLoading: false, error: null, listUnsupported: false }),
}));
vi.mock('@/hooks/use-agentteams-mutations', () => ({
  useCreateConsumer: () => ({ mutate: vi.fn(), mutateAsync: mutations.createConsumer, isPending: false }),
  useDeleteConsumer: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useBindConsumer: () => ({ mutate: vi.fn(), mutateAsync: mutations.bindConsumer, isPending: false }),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) => open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children, open }: { children: React.ReactNode; open: boolean }) => open ? <>{children}</> : null,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));

// This file renders the full ModelsSection (providers + routes + consumers)
// with many async waitFors; under parallel full-suite load on slower hosts the
// default 5s per-test budget is not enough, so relax it for the whole block.

function renderSection(tab: 'providers' | 'routes' | 'access' = 'providers') {
  render(<TooltipProvider><ModelsSection /></TooltipProvider>);
  const names = { providers: '模型连接', routes: 'AI 路由', access: '访问凭证' };
  if (tab !== 'providers') fireEvent.mouseDown(screen.getByRole('tab', { name: names[tab] }), { button: 0, ctrlKey: false });
}

describe('ModelsSection', { timeout: 20_000 }, () => {
  it('opens model connections directly without the usage overview', () => {
    renderSection();
    expect(screen.getByRole('tab', { name: '模型连接' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('tab', { name: '使用概览' })).toBeNull();
    expect(screen.queryByText('Agent 使用的模型')).toBeNull();
    expect(screen.getByRole('button', { name: '添加连接' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '添加路由' })).toBeNull();
    expect(screen.queryByRole('button', { name: '添加 Consumer' })).toBeNull();
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockRouteOverrides.value = undefined;
  });

  it('preserves the custom service port when editing a normalized provider', () => {
    providers[0].rawConfigs = { openaiCustomUrl: 'http://host.docker.internal/v1', openaiCustomServicePort: 58317 };
    try {
      renderSection('providers');
      fireEvent.click(screen.getByRole('button', { name: '编辑 openai' }));
      expect((screen.getByLabelText('API 地址（Base URL）') as HTMLInputElement).value).toBe('http://host.docker.internal:58317/v1');
      fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
      expect(mutations.updateProvider).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ rawConfigs: expect.objectContaining({ openaiCustomUrl: 'http://host.docker.internal:58317/v1' }) }) }), expect.any(Object));
    } finally {
      delete providers[0].rawConfigs;
    }
  });

  it('retains provider form input when immediate validation fails', () => {
    renderSection('providers');
    expect(screen.getByRole('tab', { name: 'AI 路由' })).toBeTruthy();
    expect(screen.queryByText(/AI 路由按/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '添加连接' }));

    const name = screen.getByLabelText('连接名称 *');
    fireEvent.change(name, { target: { value: 'new-provider' } });
    fireEvent.click(screen.getByRole('button', { name: '创建连接' }));

    expect(screen.getByText('至少需要一个凭据')).toBeTruthy();
    expect((name as HTMLInputElement).value).toBe('new-provider');
    expect(mutations.createProvider).not.toHaveBeenCalled();
  });

  it('searches provider choices and offers matching models while preserving custom model input', () => {
    renderSection('providers');
    fireEvent.click(screen.getByRole('button', { name: '添加连接' }));
    const type = screen.getByRole('combobox', { name: '厂商／平台' });
    fireEvent.focus(type);
    fireEvent.change(type, { target: { value: 'mini' } });
    expect(screen.queryByRole('option', { name: 'DeepSeek' })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: 'MiniMax' }));
    expect((type as HTMLInputElement).value).toBe('MiniMax');
    expect(screen.queryByRole('listbox')).toBeNull();

    const model = screen.getByRole('combobox', { name: '模型 ID' });
    fireEvent.focus(model);
    expect(screen.getByRole('option', { name: 'MiniMax-M3' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'MiniMax-M3.1-Flash' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'MiniMax-M2.7' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'deepseek-chat' })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: 'MiniMax-M2.7' }));
    expect((model as HTMLInputElement).value).toBe('MiniMax-M2.7');
    fireEvent.change(model, { target: { value: 'my-private-model' } });
    expect((model as HTMLInputElement).value).toBe('my-private-model');
    fireEvent.focus(type);
    fireEvent.change(type, { target: { value: 'deep' } });
    fireEvent.click(screen.getByRole('option', { name: 'DeepSeek' }));
    fireEvent.focus(model);
    expect(screen.getByRole('option', { name: 'deepseek-chat' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'MiniMax-M2.7' })).toBeNull();
    expect((model as HTMLInputElement).value).toBe('my-private-model');
  });

  it('shows Qwen 4 Token Plan restrictions after choosing the model', () => {
    renderSection('providers');
    fireEvent.click(screen.getByRole('button', { name: '添加连接' }));
    fireEvent.focus(screen.getByRole('combobox', { name: '厂商／平台' }));
    fireEvent.click(screen.getByRole('option', { name: '通义千问 (Qwen)' }));
    fireEvent.focus(screen.getByRole('combobox', { name: '模型 ID' }));
    fireEvent.click(screen.getByRole('option', { name: 'qwen4-max-preview' }));
    expect(screen.getByText(/仅支持 Token Plan/)).toBeTruthy();
  });

  it('saves a MiniMax M3 mapping through the selected OpenAI-compatible regional endpoint', () => {
    renderSection('providers');
    fireEvent.click(screen.getByRole('button', { name: '添加连接' }));
    fireEvent.focus(screen.getByRole('combobox', { name: '厂商／平台' }));
    fireEvent.click(screen.getByRole('option', { name: 'MiniMax' }));
    const baseUrl = screen.getByLabelText('API 地址（Base URL）') as HTMLInputElement;
    expect(baseUrl.value).toBe('https://api.minimax.cn/v1');
    fireEvent.change(baseUrl, { target: { value: 'https://api.minimax.io/v1' } });
    fireEvent.change(screen.getByPlaceholderText('例如 my-minimax'), { target: { value: 'my-minimax' } });
    fireEvent.change(screen.getByPlaceholderText('输入 API Key'), { target: { value: 'test-key' } });
    fireEvent.change(screen.getByRole('textbox', { name: '调用别名' }), { target: { value: 'MiniMax-M3' } });
    fireEvent.focus(screen.getByRole('combobox', { name: '模型 ID' }));
    fireEvent.click(screen.getByRole('option', { name: 'MiniMax-M3' }));
    fireEvent.click(screen.getByRole('button', { name: '创建连接' }));
    expect(mutations.createProvider).toHaveBeenCalledWith(expect.objectContaining({
      type: 'openai', tokens: ['test-key'],
      rawConfigs: { openaiCustomUrl: 'https://api.minimax.io/v1', modelMapping: { 'MiniMax-M3': 'MiniMax-M3' } },
    }), expect.any(Object));
  });

  it('saves model IDs without requiring aliases and persists compatible reasoning and output overrides', () => {
    renderSection('providers');
    fireEvent.click(screen.getByRole('button', { name: '添加连接' }));
    fireEvent.change(screen.getByLabelText('连接名称 *'), { target: { value: 'my-glm' } });
    fireEvent.change(screen.getByLabelText('API Key *'), { target: { value: 'test-key' } });
    fireEvent.focus(screen.getByRole('combobox', { name: '厂商／平台' }));
    fireEvent.click(screen.getByRole('option', { name: '智谱 AI (GLM)' }));
    fireEvent.focus(screen.getByRole('combobox', { name: '模型 ID' }));
    fireEvent.click(screen.getByRole('option', { name: 'glm-5.3' }));
    expect(screen.getByText(/上下文窗口：1,000,000 Token/)).toBeTruthy();
    expect(screen.queryByRole('option', { name: '中（medium）' })).toBeNull();
    fireEvent.change(screen.getByLabelText('思考强度'), { target: { value: 'max' } });
    fireEvent.change(screen.getByLabelText('输出 Token 上限'), { target: { value: '8192' } });
    fireEvent.click(screen.getByRole('button', { name: '创建连接' }));
    expect(mutations.createProvider).toHaveBeenCalledWith(expect.objectContaining({
      name: 'my-glm', type: 'openai', rawConfigs: expect.objectContaining({
        openaiCustomUrl: 'https://open.bigmodel.cn/api/paas/v4', modelMapping: { 'glm-5.3': 'glm-5.3' },
        customSettings: [{ name: 'max_tokens', value: 8192, mode: 'raw', overwrite: true }, { name: 'reasoning_effort', value: 'max', mode: 'raw', overwrite: true }],
      }),
    }), expect.any(Object));
    mutations.createProvider.mock.calls.at(-1)![1].onSuccess();
    expect(mutations.createRoute).toHaveBeenCalledWith(expect.objectContaining({
      modelPredicates: [{ matchType: 'EQUAL', matchValue: 'glm-5.3' }],
      upstreams: [{ provider: 'my-glm', weight: 100, modelMapping: { 'glm-5.3': 'glm-5.3' } }],
    }), expect.any(Object));
  });

  it('synchronizes model changes to an automatically created route without changing its authorization', () => {
    const authConfig = { enabled: true, allowedCredentialTypes: ['key-auth'], allowedConsumers: ['manager'] };
    mockRouteOverrides.value = [{ ...routes[0], name: 'agentteams-openai', authConfig }];
    providers[0].rawConfigs = { modelMapping: { 'gpt-4.1': 'gpt-4.1' } };
    try {
      renderSection('providers');
      fireEvent.click(screen.getByRole('button', { name: '编辑 openai' }));
      fireEvent.change(screen.getByRole('combobox', { name: '模型 ID' }), { target: { value: 'gpt-6.1-sol' } });
      fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
      mutations.updateProvider.mock.calls.at(-1)![1].onSuccess();
      expect(mutations.updateRoute).toHaveBeenCalledWith(expect.objectContaining({
        name: 'agentteams-openai', data: expect.objectContaining({ authConfig, modelPredicates: [{ matchType: 'EQUAL', matchValue: 'gpt-6.1-sol' }], upstreams: [{ provider: 'openai', weight: 100, modelMapping: { 'gpt-6.1-sol': 'gpt-6.1-sol' } }] }),
      }), expect.any(Object));
    } finally { delete providers[0].rawConfigs; }
  });

  it('keeps unknown existing options and overrides when editing only the connection name-independent fields', () => {
    providers[0].rawConfigs = { customSettings: [{ name: 'private_param', value: 42 }], extraOption: true };
    try {
      renderSection('providers');
      fireEvent.click(screen.getByRole('button', { name: '编辑 openai' }));
      fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
      expect(mutations.updateProvider).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ rawConfigs: expect.objectContaining({ customSettings: [{ name: 'private_param', value: 42 }], extraOption: true }) }) }), expect.any(Object));
    } finally { delete providers[0].rawConfigs; }
  });

  it('keeps invalid fallback JSON visible in the route form', () => {
    renderSection('routes');
    fireEvent.click(screen.getByRole('button', { name: '添加路由' }));

    const fallback = screen.getByPlaceholderText(/maxRetries/);
    fireEvent.change(fallback, { target: { value: '{invalid' } });
    fireEvent.click(screen.getByRole('button', { name: '创建路由' }));

    expect(screen.getByText('回退配置必须是有效 JSON')).toBeTruthy();
    expect((fallback as HTMLTextAreaElement).value).toBe('{invalid');
    expect(mutations.createRoute).not.toHaveBeenCalled();
  });

  it('submits a valid route creation form', () => {
    renderSection('routes');
    fireEvent.click(screen.getByRole('button', { name: '添加路由' }));

    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'new-route' } });
    fireEvent.change(screen.getByLabelText('上游模型连接'), { target: { value: 'openai' } });
    fireEvent.click(screen.getByRole('button', { name: '创建路由' }));

    expect(mutations.createRoute).toHaveBeenCalledWith(expect.objectContaining({
      name: 'new-route',
      upstreams: [expect.objectContaining({ provider: 'openai', weight: 100 })],
    }), expect.any(Object));
  });

  it('shows referenced routes before deleting a provider', () => {
    renderSection('providers');
    fireEvent.click(screen.getByRole('button', { name: '删除 openai' }));

    expect(screen.getByText('以下路由仍引用该模型连接：team-chat。删除后这些路由将失效。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(mutations.deleteProvider).toHaveBeenCalledWith('openai', expect.any(Object));
  });

  it('updates only the selected route Consumer allowlist and supports clearing it', () => {
    renderSection('routes');
    fireEvent.click(screen.getByRole('button', { name: '编辑 team-chat' }));
    const consumers = screen.getByLabelText('授权 Consumer（逗号分隔）');
    fireEvent.change(consumers, { target: { value: 'worker-alice, worker-bob,worker-alice,' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect(mutations.updateRoute).toHaveBeenLastCalledWith(expect.objectContaining({
      name: 'team-chat', data: expect.objectContaining({ authConfig: expect.objectContaining({ enabled: true, allowedConsumers: ['worker-alice', 'worker-bob'] }) }),
    }), expect.any(Object));
    fireEvent.change(consumers, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect(mutations.updateRoute).toHaveBeenLastCalledWith(expect.objectContaining({
      name: 'team-chat', data: expect.objectContaining({ authConfig: expect.objectContaining({ enabled: true, allowedConsumers: [] }) }),
    }), expect.any(Object));
  });

  it('submits route edits and confirms route deletion', () => {
    renderSection('routes');
    fireEvent.click(screen.getByRole('button', { name: '编辑 team-chat' }));
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect(mutations.updateRoute).toHaveBeenCalledWith(expect.objectContaining({ name: 'team-chat' }), expect.any(Object));

    fireEvent.click(screen.getByRole('button', { name: '删除 team-chat' }));
    expect(screen.getByText('将删除 team-chat，此操作无法撤销。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(mutations.deleteRoute).toHaveBeenCalledWith('team-chat', expect.any(Object));
  });

  it('switches a route to a new provider while preserving route structure', () => {
    renderSection('routes');
    fireEvent.click(screen.getByRole('button', { name: '切换 team-chat 模型连接' }));

    fireEvent.change(screen.getByLabelText('目标模型连接'), { target: { value: 'deepseek' } });
    fireEvent.click(screen.getByRole('button', { name: '切换并保存' }));

    expect(mutations.updateRoute).toHaveBeenCalledWith(expect.objectContaining({
      name: 'team-chat',
      data: expect.objectContaining({
        upstreams: [
          expect.objectContaining({ provider: 'openai', weight: 0, modelMapping: { 'team-chat': 'gpt-4.1' } }),
          expect.objectContaining({ provider: 'deepseek', weight: 100 }),
        ],
      }),
    }), expect.any(Object));
  });

  it('binds an existing consumer to the AI route', () => {
    renderSection('access');
    fireEvent.click(screen.getByRole('button', { name: '绑定 web-crawler' }));
    expect(mutations.bindConsumer).toHaveBeenCalledWith('web-crawler');
  });

  it('auto-binds a newly created consumer', async () => {
    mutations.createConsumer.mockResolvedValue({ name: 'my-consumer' });
    renderSection('access');
    fireEvent.click(screen.getByRole('button', { name: '添加 Consumer' }));

    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'my-consumer' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => expect(mutations.createConsumer).toHaveBeenCalledWith({ name: 'my-consumer', credential_key: undefined }));
    await waitFor(() => expect(mutations.bindConsumer).toHaveBeenCalledWith('my-consumer'));
  });

  it('shows the created API key in memory and copies it on demand', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mutations.createConsumer.mockResolvedValue({ name: 'my-consumer', api_key: 'sk-live-abcdef123456' });
    renderSection('access');
    fireEvent.click(screen.getByRole('button', { name: '添加 Consumer' }));

    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'my-consumer' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await screen.findByText('sk-live-abcdef123456');
    fireEvent.click(screen.getByRole('button', { name: '复制 API Key' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('sk-live-abcdef123456'));

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByText('sk-live-abcdef123456')).toBeNull());
  });

  it('starts a new connection with one empty model input and still allows adding more', () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: '添加连接' }));
    expect(screen.getAllByRole('combobox', { name: '模型 ID' })).toHaveLength(1);
    expect((screen.getByRole('combobox', { name: '模型 ID' }) as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '添加模型' }));
    expect(screen.getAllByRole('combobox', { name: '模型 ID' })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '添加连接' }));
    expect(screen.getAllByRole('combobox', { name: '模型 ID' })).toHaveLength(1);
  });

  it('does not save the untouched empty model row as an invalid mapping', () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: '添加连接' }));
    fireEvent.change(screen.getByLabelText('连接名称 *'), { target: { value: 'connection-only' } });
    fireEvent.change(screen.getByLabelText('API Key *'), { target: { value: 'test-key' } });
    fireEvent.click(screen.getByRole('button', { name: '创建连接' }));
    expect(mutations.createProvider).toHaveBeenCalledWith(expect.objectContaining({ name: 'connection-only' }), expect.any(Object));
    expect(mutations.createProvider.mock.calls.at(-1)![0].rawConfigs).not.toHaveProperty('modelMapping');
  });

  it('tests the selected draft model using the entered key and clears stale results when the model changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ success: true, model: 'MiniMax-M3', message: '模型已返回生成内容，连接可用', latencyMs: 42 }));
    vi.stubGlobal('fetch', fetchMock);
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: '添加连接' }));
    fireEvent.change(screen.getByLabelText('API Key *'), { target: { value: 'new-key' } });
    const model = screen.getByRole('combobox', { name: '模型 ID' });
    fireEvent.change(model, { target: { value: 'MiniMax-M3' } });
    fireEvent.click(screen.getByRole('button', { name: '测试模型 MiniMax-M3' }));
    await screen.findByText(/模型已返回生成内容/);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model: 'MiniMax-M3', token: 'new-key' });
    fireEvent.change(model, { target: { value: 'other-model' } });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('tests a saved connection without asking for or sending its stored key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ success: false, message: '模型访问被拒绝，请检查权限或额度', model: 'private-model', latencyMs: 12 }));
    vi.stubGlobal('fetch', fetchMock);
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: '测试连接 openai' }));
    expect(screen.getByRole('heading', { name: '测试连接 - openai' })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: '测试模型 ID' }), { target: { value: 'private-model' } });
    fireEvent.click(screen.getByRole('button', { name: '开始测试' }));
    await screen.findByText(/模型访问被拒绝/);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ providerName: 'openai', model: 'private-model' });
    expect(screen.queryByPlaceholderText('输入 API Key')).toBeNull();
  });

  it('requires a new key or saving first when the endpoint of a saved connection changes', () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: '编辑 openai' }));
    fireEvent.click(screen.getByRole('button', { name: '添加模型' }));
    fireEvent.change(screen.getByRole('combobox', { name: '模型 ID' }), { target: { value: 'private-model' } });
    const test = screen.getByRole('button', { name: '测试模型 private-model' });
    expect(test.hasAttribute('disabled')).toBe(false);
    fireEvent.change(screen.getByLabelText('API 地址（Base URL）'), { target: { value: 'https://other.example/v1' } });
    expect(test.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/请先保存连接或输入新 API Key/)).toBeTruthy();
  });

  it('opens the edit form for a route whose authConfig omits allowedCredentialTypes', () => {
    // Backend routes may carry an authConfig that only sets `enabled`; the edit
    // form must not crash iterating a missing credential type list.
    mockRouteOverrides.value = [{
      name: 'legacy-route',
      pathPredicate: { matchType: 'PRE', matchValue: '/v1' },
      upstreams: [{ provider: 'openai', weight: 100, modelMapping: {} }],
      authConfig: { enabled: true },
    }];

    renderSection('routes');
    fireEvent.click(screen.getByRole('button', { name: '编辑 legacy-route' }));

    expect(screen.getByText('启用认证')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: '启用认证' }) as HTMLInputElement).checked).toBe(true);
  });
});
