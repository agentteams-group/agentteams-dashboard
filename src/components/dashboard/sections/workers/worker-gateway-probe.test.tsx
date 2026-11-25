import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkerGatewayProbe } from './worker-gateway-probe';
import { agentteamsApi } from '@/lib/agentteams-api';
import { TooltipProvider } from '@/components/ui/tooltip';
vi.mock('@/lib/agentteams-api', () => ({ agentteamsApi: { getWorker: vi.fn() } }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it('probes the saved worker without forwarding any token, URL or model override', async () => {
 vi.mocked(agentteamsApi.getWorker).mockResolvedValue({ model: 'saved-model', mcpServers: [{ name: 'github', url: 'https://gw/mcp', transport: 'http' }] } as never);
 const fetcher = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ success: true, message: 'verified' }))); vi.stubGlobal('fetch', fetcher);
  render(<TooltipProvider><WorkerGatewayProbe workerName="alice" /></TooltipProvider>);
  expect(screen.getByLabelText('网关验证说明')).toBeTruthy();
 fireEvent.click(screen.getByText('验证已保存模型'));
 await waitFor(() => expect(screen.getByRole('status').textContent).toContain('saved-model：验证通过'));
 expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ kind: 'model' });
 fireEvent.click(screen.getByText('验证已保存 MCP'));
 await waitFor(() => expect(screen.getByRole('status').textContent).toContain('github：验证通过'));
 expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ kind: 'mcp', server: 'github' });
});
it('reports an unsupported older Controller instead of success', async () => {
 vi.mocked(agentteamsApi.getWorker).mockResolvedValue({ model: 'saved-model' } as never);
 vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
  render(<TooltipProvider><WorkerGatewayProbe workerName="alice" /></TooltipProvider>); fireEvent.click(screen.getByText('验证已保存模型'));
 await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Controller 暂不支持'));
});
it('shows a queued Harness probe as pending until the matching result arrives', async () => {
  vi.mocked(agentteamsApi.getWorker).mockResolvedValue({ model: 'saved-model' } as never);
  const id = 'a'.repeat(32);
  let answer!: (_value: Response) => void;
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ status: 'pending', queued: true, request_id: id, expires_at: new Date(Date.now() + 60_000).toISOString() }, { status: 202 }))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { answer = resolve; }));
  vi.stubGlobal('fetch', fetcher);
  render(<TooltipProvider><WorkerGatewayProbe workerName="alice" /></TooltipProvider>);
  fireEvent.click(screen.getByText('验证已保存模型'));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('等待 Harness'));
  expect(screen.getByRole('status').textContent).not.toContain('未通过');
  expect(screen.getByRole('status').textContent).not.toContain('验证通过');
  answer(Response.json({ version: 1, status: 'ok', reason: 'ok', request_id: id }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('saved-model：验证通过'));
});
