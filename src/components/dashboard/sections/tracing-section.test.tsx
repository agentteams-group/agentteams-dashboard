import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TracingSection } from './tracing-section';

// The first case drives two Radix comboboxes + a trace detail fetch; under
// full-suite parallel load it periodically exceeds the default 5s budget
// (passes in isolation). Widen only this file's budget — assertions and
// waitFor intervals are unchanged.
vi.setConfig({ testTimeout: 15_000 });

// jsdom has no layout scrolling; Radix uses this when focusing menu options.
const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
beforeAll(() => Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() }));
afterAll(() => {
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

it('opens an exact linked trace and span even when the trace is outside the list page', async () => {
  window.history.replaceState(null, '', '#console/governance/tracing?worker=hermes-demo&trace=linked-trace&span=linked-span');
  const fetcher = vi.fn().mockImplementation((url: string) => Promise.resolve(traceResponse(url,
    url.endsWith('/linked-trace/') ? { id: 'linked-trace', name: 'Linked trace', tags: [], metadata: {},
      observations: [{ id: 'linked-span', name: 'model.timeout', type: 'GENERATION', level: 'ERROR', startTime: '2026-11-14T01:00:00Z', endTime: '2026-11-14T01:00:01Z', output: 'Timeout from linked span' }] }
      : { data: [], meta: { page: 1, totalPages: 1, totalItems: 0 } })));
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><TracingSection /></QueryClientProvider>);
  expect(await screen.findByText(/Timeout from linked span/)).toBeTruthy();
  expect(document.querySelector('[data-selected-span="linked-span"]')).toBeTruthy();
  expect(fetcher.mock.calls.some(([url]) => url.includes('worker=hermes-demo'))).toBe(true);
  window.history.replaceState(null, '', '#console/governance/tracing?trace=next-trace');
  fireEvent(window, new HashChangeEvent('hashchange'));
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.endsWith('/next-trace/'))).toBe(true));
  view.unmount(); client.clear();
});

it.each([{ admin: true, configured: false }, { admin: false, configured: false }, { admin: true, configured: true }])('guides inactive tracing according to configuration and permissions ($configured, $admin)', async ({ admin, configured }) => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ teams: [], workers: [], canConfigure: admin, tracingConfigured: configured, tracingEnabled: false }));
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><TracingSection /></QueryClientProvider>);
  await screen.findByRole('heading', { name: configured ? 'Tracing 未启用' : 'Tracing 未配置' });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(screen.queryByText(/暂无 Trace/)).toBeNull();
  if (admin) expect(screen.getByRole('button', { name: configured ? '启用 Tracing' : '配置 Tracing' })).toBeTruthy();
  else {
    expect(screen.queryByRole('button', { name: '配置 Tracing' })).toBeNull();
    expect(screen.getByText('请联系管理员完成配置。')).toBeTruthy();
  }
  view.unmount(); client.clear();
});

function traceResponse(url: string, data: unknown) {
  return Response.json(url.includes('options=resources') ? {
    teams: [{ name: 'a', label: 'Team A' }, { name: 'b', label: 'Team B' }],
    workers: [{ name: 'hermes-demo', team: 'a', runtime: 'hermes' }, { name: 'qwen-demo', team: 'b', runtime: 'qwenpaw' }],
  } : data);
}

it('keeps ID filters behind an accessible disclosure and still submits them', async () => {
  const fetcher = vi.fn().mockImplementation((url: string) => Promise.resolve(traceResponse(url, { data: [], meta: { page: 1, totalPages: 1, totalItems: 0 } })));
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><TracingSection /></QueryClientProvider>);
  const advanced = await screen.findByRole('button', { name: '高级筛选' });
  expect(advanced.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('textbox', { name: 'Session ID' })).toBeNull();
  fireEvent.click(advanced);
  fireEvent.change(screen.getByRole('textbox', { name: 'Session ID' }), { target: { value: 'worker:session' } });
  fireEvent.click(screen.getByRole('button', { name: '查询' }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.includes('session=worker%3Asession'))).toBe(true));
  view.unmount(); client.clear();
});

it('queries server filters, opens a trace, and shows the selected span content', async () => {
  const id = 'a'.repeat(32);
  const trace = { id, name: 'hermes / worker.turn', timestamp: '2026-11-06T00:00:00Z',
    userId: 'hermes-demo', tags: ['agentteams', 'hermes', 'fixture'], metadata: {}, totalCost: 0 };
  const fetcher = vi.fn().mockImplementation((url: string) => Promise.resolve(traceResponse(url,
    url.includes(`/${id}`) ? { ...trace, langfuseUrl: 'http://localhost:13100/project/at-workers/traces/' + id,
      observations: [{ id: 'span', parentObservationId: null, name: 'openai.chat', type: 'GENERATION',
        level: 'DEFAULT', startTime: trace.timestamp, endTime: '2026-11-06T00:00:00.500Z',
        input: { prompt: 'test prompt' }, output: { text: 'test response' }, usage: { total: 66 },
        calculatedTotalCost: 0, costDetails: {} }] }
      : { data: [trace], meta: { page: 1, totalPages: 1, totalItems: 1 } },
  )));
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><TracingSection /></QueryClientProvider>);
  await screen.findByRole('button', { name: /hermes \/ worker.turn/ });
  fireEvent.keyDown(screen.getByRole('combobox', { name: '运行时' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: 'openclaw' }));
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Agent' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: 'hermes-demo' }));
  expect(screen.getByRole('combobox', { name: '运行时' }).textContent).toBe('hermes');
  expect((screen.getByRole('combobox', { name: '运行时' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '查询' }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.includes('runtime=hermes') && url.includes('worker=hermes-demo'))).toBe(true));
  fireEvent.click(await screen.findByRole('button', { name: /hermes \/ worker.turn/ }));
  fireEvent.click(await screen.findByRole('button', { name: /openai.chat/ }));
  expect(screen.getByText(/test prompt/)).toBeTruthy();
  expect(screen.getByText(/test response/)).toBeTruthy();
  expect(screen.getByText('66')).toBeTruthy();
  expect(within(screen.getByLabelText('Trace 概览')).getByText('500 ms')).toBeTruthy();
  expect(screen.getByText('未计价')).toBeTruthy();
  expect(screen.getByRole('link', { name: /Langfuse/ }).getAttribute('href')).toContain(id);
  fireEvent.keyDown(screen.getByRole('combobox', { name: '团队' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: 'Team B (b)' }));
  expect(screen.getByRole('combobox', { name: 'Agent' }).textContent).toBe('全部 Agent');
  expect(screen.getByRole('combobox', { name: '运行时' }).textContent).toBe('全部运行时');
  expect((screen.getByRole('combobox', { name: '运行时' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Agent' }), { key: 'Enter' });
  expect(screen.queryByRole('option', { name: 'hermes-demo' })).toBeNull();
  expect(screen.getByRole('option', { name: 'qwen-demo' })).toBeTruthy();
  fireEvent.click(screen.getByRole('option', { name: 'qwen-demo' }));
  expect(screen.getByRole('combobox', { name: '运行时' }).textContent).toBe('qwenpaw');
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Agent' }), { key: 'Enter' });
  fireEvent.click(screen.getByRole('option', { name: '全部 Agent' }));
  expect(screen.getByRole('combobox', { name: '运行时' }).textContent).toBe('全部运行时');
  expect((screen.getByRole('combobox', { name: '运行时' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '查询' }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.includes('team=b') && url.includes('worker=&'))).toBe(true));
  view.unmount(); client.clear();
});

it('shows token totals, input share, model shares and opens the largest call', async () => {
  const id = 'c'.repeat(32);
  const trace = { id, name: 'token-breakdown', timestamp: '2026-11-06T00:00:00Z', tags: [], metadata: {} };
  const observation = (spanId: string, start: number, end: number) => ({ id: spanId, parentObservationId: 'root',
    name: spanId, type: 'GENERATION', level: 'DEFAULT', startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString() });
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => Promise.resolve(traceResponse(url,
    url.includes(`/${id}`) ? { ...trace, observations: [
      { ...observation('root', 0, 2000), parentObservationId: null, type: 'AGENT' },
      { ...observation('first', 100, 1500), model: 'model-a', usage: { input: 70, output: 30 } },
      { ...observation('second', 200, 1800), model: 'model-b', usageDetails: { input: 110, output: 40, total: 150 }, input: 'largest prompt', output: 'largest result' },
      { ...observation('matrix.send', 2000, 2400), type: 'SPAN' },
    ] } : { data: [trace], meta: { page: 1, totalPages: 1, totalItems: 1 } },
  ))));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><TracingSection /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button', { name: /token-breakdown/ }));
  fireEvent.click(await screen.findByText('Token 消耗分布'));
  const overview = within(screen.getByLabelText('Trace 概览'));
  expect(overview.getByText('250')).toBeTruthy();
  expect(overview.getByText('2.40 s')).toBeTruthy();
  expect(screen.getByText(/输入占 72.0%/)).toBeTruthy();
  const largest = screen.getByRole('button', { name: '定位第 2 次模型调用' });
  expect(largest.textContent).toContain('150 Token · 60.0%');
  fireEvent.click(largest);
  expect(screen.getByText(/largest prompt/)).toBeTruthy();
  expect(screen.getByText(/largest result/)).toBeTruthy();
  view.unmount(); client.clear();
});

it('exports every page and trace in a session, independently of the visible page', async () => {
  const first = 'a'.repeat(32);
  const second = 'b'.repeat(32);
  const summary = (id: string) => ({ id, name: id, sessionId: 'worker-session', timestamp: '2026-11-06T00:00:00Z', tags: [], metadata: {} });
  const fetcher = vi.fn().mockImplementation((url: string) => {
    if (url.includes('options=resources')) return Promise.resolve(traceResponse(url, null));
    if (url.includes(`/${first}`) || url.includes(`/${second}`)) {
      return Promise.resolve(Response.json({ ...summary(url.includes(first) ? first : second), observations: [] }));
    }
    return Promise.resolve(Response.json({ data: [summary(url.includes('page=2') ? second : first)],
      meta: { page: url.includes('page=2') ? 2 : 1, totalPages: 2, totalItems: 2 } }));
  });
  vi.stubGlobal('fetch', fetcher);
  const create = vi.fn().mockReturnValue('blob:session-export');
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = vi.fn(); });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><TracingSection /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(first) }));
  fireEvent.click(await screen.findByRole('button', { name: '导出会话 JSON' }));
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(fetcher.mock.calls.some(([url]) => url.includes('session=worker-session') && url.includes('page=2'))).toBe(true);
  expect(fetcher.mock.calls.some(([url]) => url.includes(`/${second}`))).toBe(true);
  expect(click).toHaveBeenCalledOnce();
  click.mockRestore(); view.unmount(); client.clear();
});

it('does not query traces when the account resource scope cannot be resolved', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ error: '无法确认资源范围' }, { status: 503 }));
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><TracingSection /></QueryClientProvider>);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '无法确认资源范围');
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toContain('options=resources');
  view.unmount(); client.clear();
});
