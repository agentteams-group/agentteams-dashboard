import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TracingSettingsDialog } from './tracing-settings-dialog';

afterEach(() => vi.unstubAllGlobals());

it('saves late configuration, clears the secret field and applies only the selected Worker revision', async () => {
  const initial = { enabled: false, captureContent: true, mode: 'direct', langfuseUrl: '', publicUrl: '', projectId: '', publicKey: '',
    secretKeyConfigured: false, collectorHeadersConfigured: false, collectorEndpoint: '', revision: 'environment' };
  const fetcher = vi.fn().mockImplementation((_url: string, options: RequestInit) => {
    const body = options.body ? JSON.parse(String(options.body)) : null;
    if (options.method === 'GET') return Promise.resolve(Response.json(initial));
    if (options.method === 'PUT') return Promise.resolve(Response.json({ ...initial, ...body, secretKey: undefined, secretKeyConfigured: true, revision: 'saved-one' }));
    return Promise.resolve(Response.json({ results: [{ name: 'qwen', success: true, message: '配置已下发，等待重建' }] }));
  });
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><TracingSettingsDialog scope={{ teams: [], workers: [{ name: 'qwen', team: '', runtime: 'qwenpaw' }, { name: 'hermes', team: '', runtime: 'hermes' }] }} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: '可观测配置' }));
  await screen.findByLabelText('Langfuse 服务端地址');
  fireEvent.click(screen.getByRole('switch', { name: '启用 Worker Tracing' }));
  fireEvent.change(screen.getByLabelText('Langfuse 服务端地址'), { target: { value: 'http://langfuse.local' } });
  fireEvent.change(screen.getByLabelText('Public Key'), { target: { value: 'pk-project' } });
  fireEvent.change(screen.getByLabelText('Secret Key'), { target: { value: 'private-project-secret' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await screen.findByText('配置已保存');
  expect((screen.getByLabelText('Secret Key') as HTMLInputElement).value).toBe('');
  expect(screen.getByLabelText('Secret Key').getAttribute('placeholder')).toBe('已配置，留空保留');
  fireEvent.click(screen.getByRole('checkbox', { name: 'qwen' }));
  fireEvent.click(screen.getByRole('button', { name: '应用配置并重建所选 Worker' }));
  await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options.method === 'POST' && JSON.stringify(JSON.parse(String(options.body))) === JSON.stringify({ action: 'apply', workers: ['qwen'], revision: 'saved-one' }))).toBe(true));
  expect(await screen.findByText('qwen：配置已下发，等待重建')).toBeTruthy();
  view.unmount(); client.clear();
});
