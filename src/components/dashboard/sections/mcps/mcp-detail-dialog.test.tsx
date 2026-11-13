import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { McpDetailDialog } from './mcp-detail-dialog';
import { mcpManagementApi } from '@/lib/mcp-management-api';
import { emptyMcpConnection } from '@/lib/mcp-management';
import type { McpServerConfig } from '@/lib/agentteams-api';

vi.mock('@/lib/mcp-management-api', () => ({ mcpManagementApi: { call: vi.fn(), authorize: vi.fn(), verify: vi.fn() } }));
vi.mock('@/hooks/use-agentteams-workers', () => ({ useWorkers: () => ({ data: [{ name: 'docs-worker', team: 'demo', role: 'worker' }], isLoading: false }) }));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
const server: McpServerConfig = { name: 'docs', url: 'http://gateway/mcp-servers/docs', transport: 'streaminghttp', managed: true, gatewayState: 'ready', createdAt: '', updatedAt: '', connection: emptyMcpConnection(), authorizedWorkers: [], verification: { success: true, message: '已验证', tools: [{ name: 'search', inputSchema: { properties: { query: { type: 'string' }, limit: { type: 'number' }, options: { type: 'object' } }, required: ['query'] } }] } };

it('validates required and JSON parameters before making an explicit tool call', async () => {
  vi.mocked(mcpManagementApi.call).mockResolvedValue({ success: true, message: '完成', result: { content: [] } });
  render(<McpDetailDialog server={server} onClose={() => {}} onEdit={() => {}} onChanged={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: '运行工具' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('请填写 query');
  expect(mcpManagementApi.call).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/^query/), { target: { value: '项目文档' } });
  fireEvent.change(screen.getByLabelText(/^limit/), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText(/^options/), { target: { value: '{"exact":true}' } });
  fireEvent.click(screen.getByRole('button', { name: '运行工具' }));
  await waitFor(() => expect(mcpManagementApi.call).toHaveBeenCalledWith('docs', 'search', { query: '项目文档', limit: 3, options: { exact: true } }));
});

it('does not show a failed Agent authorization as granted', async () => {
  vi.mocked(mcpManagementApi.authorize).mockResolvedValue({ success: false, authorizedWorkers: [], results: [{ name: 'docs-worker', success: false, message: '配置同步失败，请重试。' }] });
  render(<McpDetailDialog server={server} onClose={() => {}} onEdit={() => {}} onChanged={() => {}} />);
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Agent 授权' }), { button: 0, ctrlKey: false });
  const checkbox = await screen.findByRole('checkbox');
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: /保存授权/ }));
  await screen.findByText('配置同步失败，请重试。');
  expect(screen.getByText('未授权')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '验证权限' })).not.toBeInTheDocument();
});
