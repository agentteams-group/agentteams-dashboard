// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPluginApi } from '@/lib/plugins/api';
import { useExtensionStore } from '@/lib/plugins/extension-store';
import { pluginEventBus } from '@/lib/plugins/event-bus';
import { manifest } from './manifest';
import { activate, deactivate } from './index';

describe('wen-tian diagnostic plugin', () => {
  beforeEach(() => {
    useExtensionStore.getState().clear();
    pluginEventBus.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  function buildApi() {
    const tracked: Array<() => void> = [];
    const api = createPluginApi({ manifest, trackUnregister: (fn) => tracked.push(fn) });
    return { api, tracked };
  }

  it('declares a valid manifest with the dashboard entry', () => {
    expect(manifest.id).toBe('wen-tian');
    expect(manifest.entry.dashboard).toBeTruthy();
    expect(manifest.extensionPoints).toEqual(
      expect.arrayContaining(['sidebar-menu', 'route', 'dashboard-widget'])
    );
  });

  it('activate registers one sidebar entry, one route, one widget', () => {
    const { api } = buildApi();
    activate(api);

    const state = useExtensionStore.getState();
    expect(state.menuItems).toHaveLength(1);
    expect(state.routes).toHaveLength(1);
    expect(state.widgets).toHaveLength(1);

    expect(state.menuItems[0].pluginId).toBe('wen-tian');
    expect(state.menuItems[0].contribution.target).toEqual({
      type: 'plugin-route',
      routeId: 'diagnose',
    });
    expect(state.routes[0].contribution.id).toBe('diagnose');
    expect(state.widgets[0].contribution.id).toBe('wen-tian-health');
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
});