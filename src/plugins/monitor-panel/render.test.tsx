'use client';

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPluginApi } from '@/lib/plugins/api';
import { useExtensionStore } from '@/lib/plugins/extension-store';
import { pluginEventBus } from '@/lib/plugins/event-bus';
import { manifest } from './manifest';
import { activate, deactivate } from './index';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/monitoring')) {
      return Response.json({ mode: 'embedded', sampledAt: '2026-11-14T01:00:00Z', total: 2, page: 1, totalPages: 1, limit: 12, items: [
        { kind: 'worker', name: 'w-1', availability: 'available', metrics: { state: 'running', cpuPercent: 2.17, memoryUsageBytes: 104857600, memoryLimitBytes: null, restartCount: 0, oomKilled: false, exitCode: 0, startedAt: null, sampledAt: null } },
        { kind: 'worker', name: 'w-2', availability: 'missing', metrics: null },
      ] });
    }
    if (url.includes('cluster-status')) {
      return new Response(
        JSON.stringify({ totalWorkers: 5, totalTeams: 2, totalHumans: 1, kubeMode: false }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/version')) {
      return new Response(JSON.stringify({ controller: '1.2.3', kubeMode: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/workers')) {
      return new Response(
        JSON.stringify([
          { name: 'w-1', phase: 'Running' },
          { name: 'w-2', phase: 'Sleeping' },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(null, { status: 404 });
  });
}

describe('monitor-panel rendered components', () => {
  beforeEach(() => {
    useExtensionStore.getState().clear();
    pluginEventBus.clear();
    vi.stubGlobal('fetch', mockFetch());
    const api = createPluginApi({ manifest, trackUnregister: () => {} });
    activate(api);
  });
  afterEach(() => {
    cleanup();
    deactivate();
    vi.unstubAllGlobals();
  });

  it('renders the dashboard widget and loads cluster data via the plugin API', async () => {
    const widget = useExtensionStore.getState().widgets[0];
    expect(widget.contribution.id).toBe('cluster-health');
    const Widget = widget.contribution.component;

    render(<Widget />);
    // Loading state first, then data arrives through api.dashboard.getClusterStatus.
    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument();
    });
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders container metrics through the plugin API', async () => {
    const route = useExtensionStore.getState().routes[0];
    expect(route.contribution.id).toBe('monitor');
    const Page = route.contribution.component;

    render(<QueryClientProvider client={new QueryClient()}><TooltipProvider><Page pluginId="monitor-panel" /></TooltipProvider></QueryClientProvider>);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '运行监控' })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('w-1')).toBeInTheDocument();
    });
    expect(screen.getByText('w-2')).toBeInTheDocument();
    expect(screen.getByText('2.17%')).toBeInTheDocument();
    expect(screen.getByText('100.0 MiB')).toBeInTheDocument();
  });
});
