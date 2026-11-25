import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useMatrixStore } from '@/lib/matrix-store';
import { ConnectionStatus } from './connection-status';

const infrastructure = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-agentteams-infrastructure', () => ({ useInfrastructure: infrastructure }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('shows measured latency and independent component states on focus', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  useAgentTeamsStore.setState({ connectionLatency: 83, connectionError: null });
  useMatrixStore.setState({ isLoggedIn: true, isSyncing: false });
  infrastructure.mockReturnValue({ data: { matrix: { healthy: true }, higress: { healthy: false }, kubernetes: { healthy: false, version: 'unknown' } }, isError: false, isFetching: false });
  render(<TooltipProvider><ConnectionStatus isConnected versionString="1.2.8" mode="embedded" /></TooltipProvider>);
  expect(infrastructure).toHaveBeenLastCalledWith({ enabled: false });
  fireEvent.focus(screen.getByRole('button', { name: '连接状态' }));
  expect(await screen.findByText('Controller')).toBeVisible();
  expect(screen.getByText('83 ms')).toBeVisible();
  expect(screen.getByText('检查异常')).toBeVisible();
  expect(screen.getByText('未知')).toBeVisible();
  expect(screen.queryByText('Kubernetes')).not.toBeInTheDocument();
  expect(screen.getByText('Core 1.2.8')).toBeVisible();
  expect(infrastructure).toHaveBeenLastCalledWith({ enabled: true });
});
