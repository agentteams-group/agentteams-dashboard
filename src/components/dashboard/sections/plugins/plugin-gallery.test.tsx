import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const { setSectionSpy } = vi.hoisted(() => ({
  setSectionSpy: vi.fn(),
}));

vi.mock('@/lib/section-store', () => ({
  useSectionStore: { getState: () => ({ setActiveSection: setSectionSpy }) },
}));

// BUNDLED_PLUGINS pulls the real manifests; stub the registry so the test
// does not depend on which plugins are bundled.
vi.mock('@/plugins', () => ({
  BUNDLED_PLUGINS: [
    {
      manifest: {
        id: 'wen-tian',
        name: '问天诊断',
        version: '1.2.0',
        description: '运行时诊断助手',
        author: 'AgentTeams',
        extensionPoints: ['sidebar-menu', 'route', 'dashboard-widget'],
        entry: {},
      },
      load: async () => ({ activate: () => undefined, deactivate: () => undefined }),
    },
    {
      manifest: {
        id: 'monitor-panel',
        name: '监控面板',
        version: '1.0.0',
        description: '集群监控',
        extensionPoints: ['dashboard-widget'],
        entry: {},
      },
      load: async () => ({ activate: () => undefined, deactivate: () => undefined }),
    },
  ],
}));

import { PluginGallery } from './plugin-gallery';

function seedStore(state: {
  menuItems: Array<{ pluginId: string }>;
  routes: Array<{ pluginId: string; contribution: { id: string } }>;
  widgets: Array<{ pluginId: string }>;
}) {
  vi.mocked(useExtensionStoreMock).mockImplementation((selector: (s: unknown) => unknown) =>
    selector(state),
  );
}

const useExtensionStoreMock = vi.fn();

vi.mock('@/lib/plugins/extension-store', () => ({
  useExtensionStore: (selector: (s: unknown) => unknown) => useExtensionStoreMock(selector),
}));

describe('PluginGallery (D1 17.4 MVP)', () => {
  beforeEach(() => {
    setSectionSpy.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders bundled plugins with manifest metadata and contribution counts', () => {
    seedStore({
      menuItems: [{ pluginId: 'wen-tian' }],
      routes: [{ pluginId: 'wen-tian', contribution: { id: 'diagnose' } }],
      widgets: [{ pluginId: 'wen-tian' }, { pluginId: 'monitor-panel' }],
    });
    render(<PluginGallery />);

    expect(screen.getByText('问天诊断')).toBeTruthy();
    expect(screen.getByText('v1.2.0')).toBeTruthy();
    expect(screen.getByText('监控面板')).toBeTruthy();
    // wen-tian contributes 1 menu + 1 route + 1 widget = 3.
    expect(screen.getByText('3 项贡献')).toBeTruthy();
    // monitor-panel only has a widget.
    expect(screen.getByText('1 项贡献')).toBeTruthy();
  });

  it('surfaces external URL-loaded plugins that are absent from the bundled registry', () => {
    seedStore({
      menuItems: [],
      routes: [{ pluginId: 'external-cool-tool', contribution: { id: 'main' } }],
      widgets: [],
    });
    render(<PluginGallery />);

    expect(screen.getByText('external-cool-tool')).toBeTruthy();
    expect(screen.getByText('打开')).toBeTruthy();
  });

  it('marks bundled plugins without contributions as inactive', () => {
    seedStore({ menuItems: [], routes: [], widgets: [] });
    render(<PluginGallery />);
    expect(screen.getAllByText('未激活')).toHaveLength(2);
  });

  it('opens the plugin route through the section store', () => {
    seedStore({
      menuItems: [],
      routes: [{ pluginId: 'wen-tian', contribution: { id: 'diagnose' } }],
      widgets: [],
    });
    render(<PluginGallery />);
    fireEvent.click(screen.getByText('打开'));
    expect(setSectionSpy).toHaveBeenCalledWith('plugin-route:wen-tian/diagnose');
  });
});
