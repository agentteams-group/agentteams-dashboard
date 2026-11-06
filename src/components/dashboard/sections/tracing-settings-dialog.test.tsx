import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TracingSettingsDialog } from './tracing-settings-dialog';

afterEach(() => vi.unstubAllGlobals());
const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
beforeAll(() => Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() }));
afterAll(() => {
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

it('saves late configuration, clears the secret field and applies only the selected Worker revision', async () => {
  const initial = { backend: 'langfuse', agentloop: { region: '', workspace: '', project: '', logstore: '' }, enabled: false, captureContent: true, mode: 'collector', langfuseUrl: '', publicUrl: '', projectId: '', publicKey: '',
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
  fireEvent.change(screen.getByLabelText('Collector OTLP/HTTP 地址'), { target: { value: 'http://collector:4318' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await screen.findByText('配置已保存');
  expect((screen.getByLabelText('Secret Key') as HTMLInputElement).value).toBe('');
  expect(screen.getByLabelText('Secret Key').getAttribute('placeholder')).toBe('已配置，留空保留');
  fireEvent.click(screen.getByRole('checkbox', { name: 'qwen' }));
  fireEvent.click(screen.getByRole('button', { name: '应用到所选 Worker（重建生效）' }));
  await waitFor(() => expect(fetcher.mock.calls.some(([, options]) => options.method === 'POST' && JSON.stringify(JSON.parse(String(options.body))) === JSON.stringify({ action: 'apply', workers: ['qwen'], revision: 'saved-one' }))).toBe(true));
  expect(await screen.findByText('qwen：配置已下发，等待重建')).toBeTruthy();
  view.unmount(); client.clear();
});

it('switches to AgentLoop resource configuration without asking for cloud keys in the browser', async () => {
  const initial = { backend: 'langfuse', agentloop: { region: '', workspace: '', project: '', logstore: '' }, enabled: false, captureContent: true, mode: 'collector',
    langfuseUrl: '', publicUrl: '', projectId: '', publicKey: '', secretKeyConfigured: false, collectorHeadersConfigured: false, collectorEndpoint: '', revision: 'environment' };
  const fetcher = vi.fn().mockImplementation((_url, options) => Promise.resolve(Response.json(options.method === 'GET' ? initial : { ...initial, ...JSON.parse(options.body), revision: 'agentloop-saved' })));
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><TracingSettingsDialog scope={{ teams: [], workers: [] }} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: '可观测配置' }));
  await screen.findByLabelText('查询后端');
  fireEvent.keyDown(screen.getByRole('combobox', { name: '查询后端' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: '阿里云 AgentLoop' }));
  expect(screen.queryByLabelText('Secret Key')).toBeNull();
  for (const [label, value] of [['地域', 'cn-hangzhou'], ['CMS Workspace', 'workspace-a'], ['Trace SLS Project', 'trace-project'], ['Trace Logstore', 'trace-store']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  await screen.findByText('配置已保存');
  const body = JSON.parse(fetcher.mock.calls.find(([, options]) => options.method === 'PUT')![1].body);
  expect(body).toMatchObject({ backend: 'agentloop', agentloop: { region: 'cn-hangzhou', workspace: 'workspace-a', project: 'trace-project', logstore: 'trace-store' } });
  expect(JSON.stringify(body)).not.toContain('accessKey');
  view.unmount(); client.clear();
});
