import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useManagers } from './use-agentteams-managers';
import { useHumans } from './use-agentteams-humans';

const api = vi.hoisted(() => ({ listManagers: vi.fn(), listHumans: vi.fn() }));
vi.mock('@/lib/agentteams-api', () => ({ agentteamsApi: api }));

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listManagers.mockResolvedValue([]);
  api.listHumans.mockResolvedValue([]);
});
afterEach(() => { cleanup(); useAgentTeamsStore.setState({ userLevel: 3 }); });

describe('admin-only resource queries', () => {
  it.each([1, 2])('does not query global Managers or Humans for dashboard level %s', (userLevel) => {
    useAgentTeamsStore.setState({ userLevel });
    renderHook(() => ({ managers: useManagers(), humans: useHumans() }), { wrapper });
    expect(api.listManagers).not.toHaveBeenCalled();
    expect(api.listHumans).not.toHaveBeenCalled();
  });

  it('keeps both resources available to admins', async () => {
    useAgentTeamsStore.setState({ userLevel: 3 });
    const { result } = renderHook(() => ({ managers: useManagers(), humans: useHumans() }), { wrapper });
    await waitFor(() => expect(result.current.managers.isSuccess && result.current.humans.isSuccess).toBe(true));
    expect(api.listManagers).toHaveBeenCalledOnce();
    expect(api.listHumans).toHaveBeenCalledOnce();
  });
});
