'use client';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelsSection } from './models-section';

const mutations = {
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
  createRoute: vi.fn(),
  updateRoute: vi.fn(),
  deleteRoute: vi.fn(),
};

const providers = [
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

vi.mock('@/hooks/use-agentteams-models', () => ({
  useModels: () => ({ data: providers, isLoading: false, error: null }),
  useAiRoutes: () => ({ data: routes, isLoading: false, error: null }),
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
vi.mock('@/hooks/use-agentteams-consumers', () => ({
  useConsumers: () => ({ data: [], isLoading: false, error: null, listUnsupported: false }),
}));
vi.mock('@/hooks/use-agentteams-mutations', () => ({
  useCreateConsumer: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useDeleteConsumer: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useBindConsumer: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) => open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
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

describe('ModelsSection', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('retains provider form input when immediate validation fails', () => {
    render(<ModelsSection />);
    fireEvent.click(screen.getByRole('button', { name: '添加提供商' }));

    const name = screen.getAllByRole('textbox')[0];
    fireEvent.change(name, { target: { value: 'new-provider' } });
    fireEvent.click(screen.getByRole('button', { name: '创建提供商' }));

    expect(screen.getByText('至少需要一个凭据')).toBeTruthy();
    expect((name as HTMLInputElement).value).toBe('new-provider');
    expect(mutations.createProvider).not.toHaveBeenCalled();
  });

  it('keeps invalid fallback JSON visible in the route form', () => {
    render(<ModelsSection />);
    fireEvent.click(screen.getByRole('button', { name: '添加路由' }));

    const fallback = screen.getByPlaceholderText(/maxRetries/);
    fireEvent.change(fallback, { target: { value: '{invalid' } });
    fireEvent.click(screen.getByRole('button', { name: '创建路由' }));

    expect(screen.getByText('回退配置必须是有效 JSON')).toBeTruthy();
    expect((fallback as HTMLTextAreaElement).value).toBe('{invalid');
    expect(mutations.createRoute).not.toHaveBeenCalled();
  });

  it('submits a valid route creation form', () => {
    render(<ModelsSection />);
    fireEvent.click(screen.getByRole('button', { name: '添加路由' }));

    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'new-route' } });
    fireEvent.change(screen.getByLabelText('上游提供商'), { target: { value: 'openai' } });
    fireEvent.click(screen.getByRole('button', { name: '创建路由' }));

    expect(mutations.createRoute).toHaveBeenCalledWith(expect.objectContaining({
      name: 'new-route',
      upstreams: [expect.objectContaining({ provider: 'openai', weight: 100 })],
    }), expect.any(Object));
  });

  it('shows referenced routes before deleting a provider', () => {
    render(<ModelsSection />);
    fireEvent.click(screen.getByRole('button', { name: '删除 openai' }));

    expect(screen.getByText('以下路由仍引用该提供商：team-chat。删除后这些路由将失效。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(mutations.deleteProvider).toHaveBeenCalledWith('openai', expect.any(Object));
  });

  it('submits route edits and confirms route deletion', () => {
    render(<ModelsSection />);
    fireEvent.click(screen.getByRole('button', { name: '编辑 team-chat' }));
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    expect(mutations.updateRoute).toHaveBeenCalledWith(expect.objectContaining({ name: 'team-chat' }), expect.any(Object));

    fireEvent.click(screen.getByRole('button', { name: '删除 team-chat' }));
    expect(screen.getByText('将删除 team-chat，此操作无法撤销。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(mutations.deleteRoute).toHaveBeenCalledWith('team-chat', expect.any(Object));
  });

  it('switches a route to a new provider while preserving route structure', () => {
    render(<ModelsSection />);
    fireEvent.click(screen.getByRole('button', { name: '切换 team-chat 提供商' }));

    fireEvent.change(screen.getByLabelText('目标提供商'), { target: { value: 'deepseek' } });
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

  it('renders the current request-model binding', () => {
    render(<ModelsSection />);

    expect(screen.getByText('请求模型别名绑定')).toBeTruthy();
    expect(screen.getByText('gpt-4.1')).toBeTruthy();
    expect(screen.getAllByText('可用').length).toBeGreaterThan(0);
  });
});
