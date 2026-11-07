import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { agentteamsApi } from '@/lib/agentteams-api';
import { ApiError } from '@/lib/api-error';
import { HumanSyncPanel } from './human-sync-panel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <HumanSyncPanel humanName="alice" />
    </QueryClientProvider>,
  );
  return client;
}

it('renders generation, entry count and the manifest ETag', async () => {
  vi.spyOn(agentteamsApi, 'getHumanSyncStatus').mockResolvedValue({
    entries: 12,
    tombstones: 2,
    generation: 7,
    updatedAt: '2026-11-06T09:30:00Z',
    updatedBy: 'alice',
  });
  vi.spyOn(agentteamsApi, 'getHumanSyncManifest').mockResolvedValue({
    manifest: {
      version: 1,
      generation: 7,
      entries: {},
      tombstones: [],
      updatedAt: '2026-11-06T09:30:00Z',
      updatedBy: 'alice',
    },
    etag: 'W/"etag-1"',
  });

  renderPanel();

  expect(await screen.findByText('代次')).toBeInTheDocument();
  expect(screen.getByText('7')).toBeInTheDocument();
  expect(screen.getByText(/12（墓碑 2）/)).toBeInTheDocument();
  expect(screen.getByText('W/"etag-1"')).toBeInTheDocument();
});

it('degrades a 405 sync read to an empty state', async () => {
  vi.spyOn(agentteamsApi, 'getHumanSyncStatus').mockRejectedValue(
    new ApiError('API Error 405', 405, '/humans/alice/sync/status'),
  );
  const manifestSpy = vi.spyOn(agentteamsApi, 'getHumanSyncManifest');

  renderPanel();

  expect(
    await screen.findByText(/当前 Controller 不支持同步状态接口（405）/),
  ).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(manifestSpy).not.toHaveBeenCalled();
});

it('shows the empty manifest state for a zero summary', async () => {
  vi.spyOn(agentteamsApi, 'getHumanSyncStatus').mockResolvedValue({
    entries: 0,
    tombstones: 0,
    generation: 0,
    updatedAt: '',
    updatedBy: '',
  });
  vi.spyOn(agentteamsApi, 'getHumanSyncManifest').mockRejectedValue(
    new ApiError('API Error 404', 404, '/humans/alice/sync/manifest'),
  );

  renderPanel();

  expect(await screen.findByText(/暂无同步记录/)).toBeInTheDocument();
});
