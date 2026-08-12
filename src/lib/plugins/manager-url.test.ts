// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loaderMock = vi.hoisted(() => ({
  fetchManifestJson: vi.fn(),
  loadUrlPluginModule: vi.fn(),
  hashString: vi.fn(() => 'hash'),
  resolveEntryUrl: vi.fn((manifestUrl: string, entry: string) => `${manifestUrl}::${entry}`),
}));

vi.mock('./loader', () => loaderMock);

import { pluginManager } from './manager';
import { usePluginRegistry } from './registry';
import { useExtensionStore } from './extension-store';
import { pluginEventBus } from './event-bus';
import type { PluginModule } from './types';

const validManifest = {
  id: 'url-plugin',
  name: 'Url Plugin',
  version: '1.0.0',
  entry: { dashboard: 'index.js' },
};

function fakeModule(): PluginModule {
  return {
    activate: (api) => {
      api.registerWidget({ id: 'u-w', title: 'U', component: (() => null) as never });
    },
    deactivate: () => {},
  };
}

function reset() {
  pluginManager.resetForTests();
  usePluginRegistry.setState({ records: {}, installedUrls: [], disabledIds: [], ready: false });
  useExtensionStore.getState().clear();
  pluginEventBus.clear();
}

describe('plugin manager url flows', () => {
  beforeEach(() => {
    reset();
    vi.clearAllMocks();
    loaderMock.resolveEntryUrl.mockImplementation((m: string, e: string) => `${m}::${e}`);
    loaderMock.hashString.mockReturnValue('hash');
  });

  it('installFromUrl validates, registers and activates a url plugin', async () => {
    loaderMock.fetchManifestJson.mockResolvedValue(validManifest);
    loaderMock.loadUrlPluginModule.mockResolvedValue(fakeModule());

    await pluginManager.installFromUrl('http://cdn/plugin.json');

    const registry = usePluginRegistry.getState();
    expect(registry.records['url-plugin'].status).toBe('active');
    expect(registry.installedUrls).toContain('http://cdn/plugin.json');
    expect(useExtensionStore.getState().widgets).toHaveLength(1);
  });

  it('installFromUrl rejects an invalid manifest', async () => {
    loaderMock.fetchManifestJson.mockResolvedValue({ id: 'BAD ID', entry: {} });
    await expect(pluginManager.installFromUrl('http://cdn/plugin.json')).rejects.toThrow();
    expect(usePluginRegistry.getState().records['BAD ID']).toBeUndefined();
  });

  it('installFromUrl does not duplicate an already-installed url', async () => {
    loaderMock.fetchManifestJson.mockResolvedValue(validManifest);
    loaderMock.loadUrlPluginModule.mockResolvedValue(fakeModule());
    await pluginManager.installFromUrl('http://cdn/plugin.json');
    await pluginManager.installFromUrl('http://cdn/plugin.json');
    expect(usePluginRegistry.getState().installedUrls).toEqual(['http://cdn/plugin.json']);
  });

  it('reload deactivates then re-activates a url plugin', async () => {
    loaderMock.fetchManifestJson.mockResolvedValue(validManifest);
    loaderMock.loadUrlPluginModule.mockResolvedValue(fakeModule());
    await pluginManager.installFromUrl('http://cdn/plugin.json');
    expect(useExtensionStore.getState().widgets).toHaveLength(1);

    await pluginManager.reload('url-plugin');

    expect(usePluginRegistry.getState().records['url-plugin'].status).toBe('active');
    expect(useExtensionStore.getState().widgets).toHaveLength(1);
  });

  it('uninstall removes a url plugin and its persisted url', async () => {
    loaderMock.fetchManifestJson.mockResolvedValue(validManifest);
    loaderMock.loadUrlPluginModule.mockResolvedValue(fakeModule());
    await pluginManager.installFromUrl('http://cdn/plugin.json');

    await pluginManager.uninstall('url-plugin');

    expect(usePluginRegistry.getState().records['url-plugin']).toBeUndefined();
    expect(usePluginRegistry.getState().installedUrls).not.toContain('http://cdn/plugin.json');
    expect(useExtensionStore.getState().widgets).toHaveLength(0);
  });
});

describe('plugin manager init (bundled discovery)', () => {
  beforeEach(() => {
    reset();
    vi.clearAllMocks();
    // Server plugin discovery returns nothing; bundled plugins still load.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ plugins: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('init discovers bundled plugins, activates them, and marks the registry ready', async () => {
    await pluginManager.init();

    const registry = usePluginRegistry.getState();
    expect(registry.ready).toBe(true);
    expect(registry.records['monitor-panel']).toBeDefined();
    expect(registry.records['monitor-panel'].status).toBe('active');

    // The example plugin contributes a menu item, a route and a widget.
    expect(useExtensionStore.getState().menuItems.length).toBeGreaterThanOrEqual(1);
    expect(useExtensionStore.getState().routes.length).toBeGreaterThanOrEqual(1);
    expect(useExtensionStore.getState().widgets.length).toBeGreaterThanOrEqual(1);
  });

  it('init is idempotent (second call reuses the same promise)', async () => {
    await pluginManager.init();
    await pluginManager.init();
    expect(usePluginRegistry.getState().ready).toBe(true);
    // No duplicate contributions from running discovery twice.
    const menuItemIds = useExtensionStore
      .getState()
      .menuItems.filter((m) => m.pluginId === 'monitor-panel');
    expect(menuItemIds).toHaveLength(1);
  });
});
