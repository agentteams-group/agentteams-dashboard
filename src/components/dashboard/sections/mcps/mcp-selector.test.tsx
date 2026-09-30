import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { McpSelector } from './mcp-selector';
vi.mock('@/hooks/use-agentteams-mcps', () => ({ useMcpServers: () => ({ data: [{ name: 'github', url: 'https://gateway/mcp-servers/github/mcp', transport: 'streaminghttp', headers: { Authorization: 'upstream-secret' } }] }) }));
vi.mock('@/components/ui/dialog', () => ({
 Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
 DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
 DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
 DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
 DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
 DialogTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
afterEach(cleanup);
it('projects the Controller transport without copying upstream credentials', () => {
 const change = vi.fn(); render(<McpSelector value={[]} onChange={change} />);
 fireEvent.click(screen.getByRole('button', { name: /github.*streaminghttp/ }));
 fireEvent.click(screen.getByRole('button', { name: '确定 (1 个)' }));
 expect(change).toHaveBeenCalledWith([{ name: 'github', url: 'https://gateway/mcp-servers/github/mcp', transport: 'http' }]);
 expect(screen.queryByText('upstream-secret')).toBeNull();
});

it('B7 21.1: defaultSelectedNames pre-seed the draft on first open', () => {
 const change = vi.fn(); render(<McpSelector value={[]} onChange={change} defaultSelectedNames={['github']} />);
 fireEvent.click(screen.getByRole('button', { name: /github.*streaminghttp/ }));
 fireEvent.click(screen.getByRole('button', { name: '确定 (1 个)' }));
 expect(change).toHaveBeenCalledWith([{ name: 'github', url: 'https://gateway/mcp-servers/github/mcp', transport: 'http' }]);
});

it('B7 21.1: unknown default names are ignored', () => {
 const change = vi.fn(); render(<McpSelector value={[]} onChange={change} defaultSelectedNames={['not-in-registry']} />);
 fireEvent.click(screen.getByRole('button', { name: /选择 MCP 服务器/ }));
 fireEvent.click(screen.getByRole('button', { name: '确定 (0 个)' }));
 expect(change).toHaveBeenCalledWith([]);
});

it('B7 21.1: an explicit selection is not duplicated by the defaults', () => {
 const change = vi.fn(); render(
   <McpSelector
     value={[{ name: 'github', url: 'https://gateway/mcp-servers/github/mcp', transport: 'http' }]}
     onChange={change}
     defaultSelectedNames={['github']}
   />,
 );
 // 已选 chips 只有一份 github，且它被排除出候选列表（filtered 按 value 排除），
 // 因此 defaultSelectedNames 的叠加路径无从触发重复。
 expect(screen.getAllByText('github').length).toBe(1);
 expect(screen.getByText('暂无已登记的 MCP 地址，请先到资源中心 → MCP 服务器登记')).toBeTruthy();
 expect(change).not.toHaveBeenCalled();
});
