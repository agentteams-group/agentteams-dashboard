import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkerGatewayProbe } from './worker-gateway-probe';
import { agentteamsApi } from '@/lib/agentteams-api';
vi.mock('@/lib/agentteams-api', () => ({ agentteamsApi: { getWorker: vi.fn() } }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it('probes the saved worker without forwarding any token, URL or model override', async () => {
 vi.mocked(agentteamsApi.getWorker).mockResolvedValue({ model: 'saved-model', mcpServers: [{ name: 'github', url: 'https://gw/mcp', transport: 'http' }] } as never);
 const fetcher = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ success: true, message: 'verified' }))); vi.stubGlobal('fetch', fetcher);
 render(<WorkerGatewayProbe workerName="alice" />);
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
 render(<WorkerGatewayProbe workerName="alice" />); fireEvent.click(screen.getByText('验证已保存模型'));
 await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Controller 暂不支持'));
});
