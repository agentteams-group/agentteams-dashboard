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
