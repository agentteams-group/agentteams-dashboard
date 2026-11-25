import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { ManagerModelSetup } from './manager-model-setup';
import { configureManagerModel } from '@/lib/configure-manager-model';

vi.mock('@/hooks/use-model-selection', () => ({ useModelSelection: () => ({ options: [] }) }));
vi.mock('@/lib/configure-manager-model', () => ({ configureManagerModel: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); window.location.hash = ''; });

it('saves the first API key and returns to the originating conversation after validation', async () => {
  window.location.hash = '#console/resources/models?manager=default&returnTo=workbench%2Fspace';
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><ManagerModelSetup /></QueryClientProvider>);
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'synthetic-key' } });
  fireEvent.click(screen.getByRole('button', { name: '保存并开始对话' }));
  await waitFor(() => expect(configureManagerModel).toHaveBeenCalledWith('default', {
    model: 'qwen3.6-plus', baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', apiKey: 'synthetic-key',
  }, expect.any(Function)));
  await waitFor(() => expect(window.location.hash).toBe('#workbench/space'));
});

it('keeps the form open and reports validation failure', async () => {
  vi.mocked(configureManagerModel).mockRejectedValueOnce(new Error('API Key 无效'));
  window.location.hash = '#console/resources/models?manager=default';
  render(<QueryClientProvider client={new QueryClient()}><ManagerModelSetup /></QueryClientProvider>);
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'invalid-key' } });
  fireEvent.click(screen.getByRole('button', { name: '保存并开始对话' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('API Key 无效');
  expect(window.location.hash).toContain('console/resources/models');
});
