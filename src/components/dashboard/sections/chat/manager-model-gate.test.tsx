import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { ManagerModelGate } from './manager-model-gate';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.location.hash = ''; });

function show(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: status === 200, status, json: async () => body }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ManagerModelGate name="default">{(configured) => <button disabled={!configured}>发送消息</button>}</ManagerModelGate></QueryClientProvider>);
}

it('guides an unconfigured manager to model management without sending a message', async () => {
  window.location.hash = '#workbench/space';
  show(200, { configured: false });
  fireEvent.click(await screen.findByRole('button', { name: '配置模型' }));
  expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled();
  expect(window.location.hash).toContain('console/resources/models?manager=default');
  expect(window.location.hash).toContain('returnTo=workbench%2Fspace');
});

it('allows conversation immediately when environment configuration already exists', async () => {
  show(200, { configured: true });
  await waitFor(() => expect(screen.getByRole('button', { name: '发送消息' })).toBeEnabled());
  expect(screen.queryByRole('button', { name: '配置模型' })).not.toBeInTheDocument();
});

it('does not misreport a gateway lookup failure as missing credentials', async () => {
  show(502, {});
  expect(await screen.findByText(/暂时无法检查模型配置/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '配置模型' })).not.toBeInTheDocument();
});
