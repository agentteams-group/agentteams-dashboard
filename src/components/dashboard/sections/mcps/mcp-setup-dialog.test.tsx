import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpSetupDialog } from './mcp-setup-dialog';
import { mcpManagementApi } from '@/lib/mcp-management-api';

vi.mock('@/lib/mcp-management-api', () => ({ mcpManagementApi: { capabilities: vi.fn(), save: vi.fn(), verify: vi.fn(), importOpenApi: vi.fn() } }));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(mcpManagementApi.capabilities).mockResolvedValue({ available: true, gateway: 'http://gateway' });
  vi.mocked(mcpManagementApi.save).mockResolvedValue({ name: 'docs', url: 'http://gateway/mcp-servers/docs', managed: true } as never);
  vi.mocked(mcpManagementApi.verify).mockResolvedValue({ success: true, message: '验证通过', tools: [{ name: 'search', inputSchema: {} }] });
});

describe('MCP setup flow', () => {
  function renderSetup() { const onSaved = vi.fn(); render(<McpSetupDialog open onOpenChange={() => {}} onSaved={onSaved} />); return onSaved; }
  it('keeps advanced fields hidden, saves backend auth and multiple parameters, then verifies the saved gateway', async () => {
    const onSaved = renderSetup();
    expect(screen.getByRole('button', { name: /已有 MCP/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.change(screen.getByLabelText('服务名称'), { target: { value: 'docs' } });
    fireEvent.change(screen.getByLabelText('后端 MCP 地址'), { target: { value: 'http://backend/mcp' } });
    expect(screen.queryByLabelText('Header 名称 1')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('后端认证方式'), { target: { value: 'bearer' } });
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'private-token' } });
    fireEvent.click(screen.getByRole('button', { name: /高级配置/ }));
    fireEvent.click(screen.getAllByRole('button', { name: '添加参数' })[0]);
    fireEvent.change(screen.getByLabelText('Header 名称 1'), { target: { value: 'X-Tenant-Id' } });
    fireEvent.change(screen.getByLabelText('Header 值 1'), { target: { value: 'demo-team' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '保存并验证' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '保存并验证' }));
    await screen.findByText('MCP 已接入，工具验证通过');
    expect(mcpManagementApi.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'docs', connection: expect.objectContaining({ auth: expect.objectContaining({ type: 'bearer', secret: 'private-token' }), headers: [{ name: 'X-Tenant-Id', value: 'demo-team' }] }) }));
    expect(mcpManagementApi.verify).toHaveBeenCalledWith('docs');
    expect(screen.getByText('完成后选择，默认不授权')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '完成，查看详情' }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: 'docs', verification: expect.objectContaining({ success: true }) }));
  });
  it('shows failed verification honestly and permits retry without saving again', async () => {
    vi.mocked(mcpManagementApi.verify).mockResolvedValueOnce({ success: false, message: '网关配置正在生效' });
    renderSetup();
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.change(screen.getByLabelText('服务名称'), { target: { value: 'docs' } });
    fireEvent.change(screen.getByLabelText('后端 MCP 地址'), { target: { value: 'http://backend/mcp' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '保存并验证' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: '保存并验证' }));
    await screen.findByText('配置已启用，等待验证');
    expect(screen.getByRole('button', { name: '保存，稍后验证' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '重新验证' }));
    await screen.findByText('MCP 已接入，工具验证通过');
    expect(mcpManagementApi.save).toHaveBeenCalledTimes(1);
  });
  it('only shows database fields for database connections', async () => {
    renderSetup();
    fireEvent.click(screen.getByRole('button', { name: /数据库转 MCP/ }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByLabelText('数据库类型')).toHaveValue('MYSQL');
    expect(screen.queryByLabelText('后端 MCP 地址')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('数据库类型'), { target: { value: 'POSTGRESQL' } });
    expect(screen.getByLabelText('端口')).toHaveValue(5432);
  });
});
