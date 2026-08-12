// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPluginApi } from '@/lib/plugins/api';
import { useExtensionStore } from '@/lib/plugins/extension-store';
import { pluginEventBus } from '@/lib/plugins/event-bus';
import { manifest } from './manifest';
import { activate, deactivate } from './index';

describe('monitor-panel example plugin', () => {
  beforeEach(() => {
    useExtensionStore.getState().clear();
    pluginEventBus.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  function buildApi() {
    const tracked: Array<() => void> = [];
    const api = createPluginApi({ manifest, trackUnregister: (fn) => tracked.push(fn) });
    return { api, tracked };
  }

  it('declares a valid manifest with the dashboard entry', () => {
    expect(manifest.id).toBe('monitor-panel');
    expect(manifest.entry.dashboard).toBeTruthy();
    expect(manifest.extensionPoints).toEqual(
      expect.arrayContaining(['sidebar-menu', 'route', 'dashboard-widget'])
    );
  });

  it('activate registers a sidebar menu item, a route and a dashboard widget', () => {
    const { api } = buildApi();
    activate(api);

    const state = useExtensionStore.getState();
    expect(state.menuItems).toHaveLength(1);
    expect(state.routes).toHaveLength(1);
    expect(state.widgets).toHaveLength(1);

    expect(state.menuItems[0].pluginId).toBe('monitor-panel');
    expect(state.menuItems[0].contribution.target).toEqual({
      type: 'plugin-route',
      routeId: 'monitor',
    });
    expect(state.routes[0].contribution.id).toBe('monitor');
    expect(state.widgets[0].contribution.id).toBe('cluster-health');
  });

  it('deactivate removes every contribution', () => {
    const { api } = buildApi();
    activate(api);
    expect(useExtensionStore.getState().menuItems).toHaveLength(1);

    deactivate();

    const state = useExtensionStore.getState();
    expect(state.menuItems).toHaveLength(0);
    expect(state.routes).toHaveLength(0);
    expect(state.widgets).toHaveLength(0);
  });

  it('re-activation after deactivate works cleanly', () => {
    const { api } = buildApi();
    activate(api);
    deactivate();
    activate(api);
    expect(useExtensionStore.getState().widgets).toHaveLength(1);
    deactivate();
    expect(useExtensionStore.getState().widgets).toHaveLength(0);
  });
});
