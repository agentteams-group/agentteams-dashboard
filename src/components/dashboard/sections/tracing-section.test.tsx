import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TracingSection } from './tracing-section';

afterEach(() => { vi.unstubAllGlobals(); });

it('queries server filters, opens a trace, and shows the selected span content', async () => {
  const id = 'a'.repeat(32);
  const trace = { id, name: 'hermes / worker.turn', timestamp: '2026-11-06T00:00:00Z',
    userId: 'hermes-demo', tags: ['agentteams', 'hermes', 'fixture'], metadata: {}, totalCost: 0 };
  const fetcher = vi.fn().mockImplementation((url: string) => Promise.resolve(Response.json(
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
  fireEvent.change(screen.getByLabelText('运行时'), { target: { value: 'hermes' } });
  fireEvent.change(screen.getByLabelText('Worker'), { target: { value: 'hermes-demo' } });
  fireEvent.click(screen.getByRole('button', { name: '查询' }));
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.includes('runtime=hermes') && url.includes('worker=hermes-demo'))).toBe(true));
  fireEvent.click(await screen.findByRole('button', { name: /hermes \/ worker.turn/ }));
  fireEvent.click(await screen.findByRole('button', { name: /openai.chat/ }));
  expect(screen.getByText(/test prompt/)).toBeTruthy();
  expect(screen.getByText(/test response/)).toBeTruthy();
  expect(screen.getByText('66')).toBeTruthy();
  expect(screen.getByText('未计价')).toBeTruthy();
  expect(screen.getByRole('link', { name: /Langfuse/ }).getAttribute('href')).toContain(id);
  view.unmount(); client.clear();
});
