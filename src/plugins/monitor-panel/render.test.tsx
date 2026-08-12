'use client';

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPluginApi } from '@/lib/plugins/api';
import { useExtensionStore } from '@/lib/plugins/extension-store';
import { pluginEventBus } from '@/lib/plugins/event-bus';
import { manifest } from './manifest';
import { activate, deactivate } from './index';

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
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

  it('renders the standalone monitor page with stats and worker distribution', async () => {
    const route = useExtensionStore.getState().routes[0];
    expect(route.contribution.id).toBe('monitor');
    const Page = route.contribution.component;

    render(<Page pluginId="monitor-panel" />);
    await waitFor(() => {
      expect(screen.getByText('集群监控')).toBeInTheDocument();
    });
    // Worker phase distribution comes from api.dashboard.listWorkers.
    await waitFor(() => {
      expect(screen.getByText(/Running: 1/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Sleeping: 1/)).toBeInTheDocument();
  });
});
