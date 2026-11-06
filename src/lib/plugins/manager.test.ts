// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pluginManager } from './manager';
import { makePluginRecord, usePluginRegistry } from './registry';
import { useExtensionStore } from './extension-store';
import { pluginEventBus, HOST_EVENTS } from './event-bus';
import type { DashboardPluginApi, PluginManifest, PluginModule } from './types';

function manifest(id: string, extensionPoints?: PluginManifest['extensionPoints']): PluginManifest {
  return { id, name: id, version: '1.0.0', entry: { dashboard: 'index.js' }, extensionPoints };
}

/** Builds a bundled plugin source whose module registers one widget + menu item. */
function fakeBundled(id: string, opts: { throwOnActivate?: boolean } = {}) {
  const mod: PluginModule = {
    activate: (api: DashboardPluginApi) => {
      if (opts.throwOnActivate) throw new Error(`${id} exploded during activate`);
      api.registerWidget({
        id: `${id}-widget`,
        title: `${id} widget`,
        component: (() => null) as never,
      });
      api.registerMenuItem({
        id: `${id}-menu`,
        label: id,
        target: { type: 'section', sectionId: 'overview' },
      });
    },
    deactivate: () => {},
  };
  return {
    manifest: manifest(id, ['dashboard-widget', 'sidebar-menu']),
    source: { kind: 'bundled' as const, load: () => Promise.resolve(mod) },
  };
}

function register(record: ReturnType<typeof makePluginRecord>) {
  usePluginRegistry.getState().upsertRecord(record);
}

function statusOf(id: string) {
  return usePluginRegistry.getState().records[id]?.status;
}

describe('plugin manager lifecycle', () => {
  beforeEach(() => {
    pluginManager.resetForTests();
    usePluginRegistry.setState({ records: {}, installedUrls: [], disabledIds: [], ready: false });
    useExtensionStore.getState().clear();
    pluginEventBus.clear();
  });

  it('activates a bundled plugin: installed → active with contributions', async () => {
    const { manifest: m, source } = fakeBundled('alpha');
    register(makePluginRecord(m, source));

    await pluginManager.activate('alpha');

    expect(statusOf('alpha')).toBe('active');
    expect(useExtensionStore.getState().widgets).toHaveLength(1);
    expect(useExtensionStore.getState().menuItems).toHaveLength(1);
    expect(useExtensionStore.getState().widgets[0].pluginId).toBe('alpha');
  });

  it('disable removes all contributions and marks the plugin disabled', async () => {
    const { manifest: m, source } = fakeBundled('alpha');
    register(makePluginRecord(m, source));
    await pluginManager.activate('alpha');
    expect(useExtensionStore.getState().widgets).toHaveLength(1);

    await pluginManager.disable('alpha');

    expect(statusOf('alpha')).toBe('disabled');
    expect(useExtensionStore.getState().widgets).toHaveLength(0);
    expect(useExtensionStore.getState().menuItems).toHaveLength(0);
    expect(usePluginRegistry.getState().disabledIds).toContain('alpha');
  });

  it('enable re-activates a disabled plugin', async () => {
    const { manifest: m, source } = fakeBundled('alpha');
    register(makePluginRecord(m, source));
    await pluginManager.activate('alpha');
    await pluginManager.disable('alpha');
    await pluginManager.enable('alpha');
    expect(statusOf('alpha')).toBe('active');
    expect(useExtensionStore.getState().widgets).toHaveLength(1);
  });

  it('contains activation errors: status error, no leaked contributions', async () => {
    const { manifest: m, source } = fakeBundled('bomb', { throwOnActivate: true });
    register(makePluginRecord(m, source));

    await expect(pluginManager.activate('bomb')).rejects.toThrow(/exploded/);

    expect(statusOf('bomb')).toBe('error');
    expect(usePluginRegistry.getState().records['bomb'].error).toMatch(/exploded/);
    expect(useExtensionStore.getState().widgets).toHaveLength(0);
    expect(usePluginRegistry.getState().ready ?? false).toBe(false);
  });

  it('runs at least three plugins simultaneously without interference', async () => {
    for (const id of ['one', 'two', 'three']) {
      const { manifest: m, source } = fakeBundled(id);
      register(makePluginRecord(m, source));
    }

    await pluginManager.activate('one');
    await pluginManager.activate('two');
    await pluginManager.activate('three');

    expect(useExtensionStore.getState().widgets).toHaveLength(3);
    expect(useExtensionStore.getState().menuItems).toHaveLength(3);

    // Disabling one leaves the other two intact.
    await pluginManager.disable('two');
    const widgetOwners = useExtensionStore.getState().widgets.map((w) => w.pluginId).sort();
    expect(widgetOwners).toEqual(['one', 'three']);
  });

  it('uninstall removes the record, url and persisted state', async () => {
    const { manifest: m, source } = fakeBundled('gone');
    register(makePluginRecord(m, source));
    usePluginRegistry.getState().addInstalledUrl('http://example/plugin.json');
    await pluginManager.activate('gone');

    await pluginManager.uninstall('gone');

    expect(usePluginRegistry.getState().records['gone']).toBeUndefined();
    expect(useExtensionStore.getState().widgets).toHaveLength(0);
  });

  it('emits host lifecycle events on the bus', async () => {
    const activated = vi.fn();
    const deactivated = vi.fn();
    pluginEventBus.on(HOST_EVENTS.pluginActivated, activated);
    pluginEventBus.on(HOST_EVENTS.pluginDeactivated, deactivated);

    const { manifest: m, source } = fakeBundled('evt');
    register(makePluginRecord(m, source));
    await pluginManager.activate('evt');
    await pluginManager.disable('evt');

    expect(activated).toHaveBeenCalledWith({ pluginId: 'evt' });
    expect(deactivated).toHaveBeenCalledWith({ pluginId: 'evt' });
  });

  it('rejects a module without an activate export', async () => {
    const m = manifest('noact', ['sidebar-menu']);
    register(
      makePluginRecord(m, { kind: 'bundled', load: () => Promise.resolve({} as PluginModule) })
    );
    await expect(pluginManager.activate('noact')).rejects.toThrow(/activate/);
    expect(statusOf('noact')).toBe('error');
  });

  it('installFromManifestJson rejects a relative entry with a clear error', async () => {
    const manifestJson: PluginManifest = {
      id: 'uploaded-relative',
      name: 'uploaded-relative',
      version: '1.0.0',
      entry: { dashboard: 'index.js' },
      extensionPoints: ['sidebar-menu'],
    };
    await expect(pluginManager.installFromManifestJson(manifestJson)).rejects.toThrow(
      /绝对 http\(s\) URL/
    );
    expect(usePluginRegistry.getState().records['uploaded-relative']).toBeUndefined();
  });

  it('installFromManifestJson installs an absolute-entry manifest without persisting', async () => {
    const manifestJson: PluginManifest = {
      id: 'uploaded',
      name: 'uploaded',
      version: '1.2.3',
      entry: { dashboard: 'https://example.com/plugin/index.js' },
      extensionPoints: ['sidebar-menu'],
    };
    // Pre-mark disabled so the install path skips activation (the remote entry
    // module is not actually reachable in the test environment).
    usePluginRegistry.setState({ disabledIds: ['uploaded'] });

    const record = await pluginManager.installFromManifestJson(manifestJson);

    expect(record.manifest.id).toBe('uploaded');
    expect(record.source.kind).toBe('url');
    expect(record.source.manifestUrl).toBe('uploaded://uploaded/plugin.json');
    // Uploaded manifests are not persisted: reloading cannot re-fetch the code.
    expect(usePluginRegistry.getState().installedUrls).not.toContain(
      'uploaded://uploaded/plugin.json'
    );
  });

  it('installFromManifestJson rejects an invalid manifest', async () => {
    await expect(
      pluginManager.installFromManifestJson({ not: 'a manifest' })
    ).rejects.toThrow();
  });

  // f7-1: load 可控挂起的 bundled 插件——模拟 URL 插件跨网络加载挂起数秒。
  function deferredBundled(id: string, extensionPoints?: PluginManifest['extensionPoints']) {
    let resolveLoad!: (_mod: PluginModule) => void;
    const loadPromise = new Promise<PluginModule>((resolve) => {
      resolveLoad = resolve;
    });
    const activateFn = vi.fn();
    const mod: PluginModule = {
      activate: (api: DashboardPluginApi) => {
        activateFn();
        api.registerWidget({
          id: `${id}-widget`,
          title: `${id} widget`,
          component: (() => null) as never,
        });
        api.registerMenuItem({
          id: `${id}-menu`,
          label: id,
          target: { type: 'section', sectionId: 'overview' },
        });
      },
      deactivate: () => {},
    };
    return {
      activateFn,
      load: () => loadPromise,
      resolveLoad: () => resolveLoad(mod),
      record: makePluginRecord(manifest(id, extensionPoints), {
        kind: 'bundled' as const,
        load: () => loadPromise,
      }),
    };
  }

  it('f7-1: 激活挂起期间 disable → 恢复后放弃注入贡献且状态保持 disabled', async () => {
    const deferred = deferredBundled('alpha', ['dashboard-widget', 'sidebar-menu']);
    register(deferred.record);

    const activation = pluginManager.activate('alpha');
    // load 挂起中用户停用（disable 自身无挂起点，先行完成）。
    await pluginManager.disable('alpha');
    deferred.resolveLoad();
    await activation;

    // 恢复执行时复查 disabledIds：activate() 未被调用，无注入贡献。
    expect(deferred.activateFn).not.toHaveBeenCalled();
    expect(statusOf('alpha')).toBe('disabled');
    expect(usePluginRegistry.getState().disabledIds).toContain('alpha');
    expect(useExtensionStore.getState().widgets).toHaveLength(0);
    expect(useExtensionStore.getState().menuItems).toHaveLength(0);
  });

  it('f7-1: 并发 activate 被在途守卫挡住，activator 只执行一次', async () => {
    const deferred = deferredBundled('alpha', ['dashboard-widget', 'sidebar-menu']);
    register(deferred.record);

    const first = pluginManager.activate('alpha');
    const second = pluginManager.activate('alpha');
    deferred.resolveLoad();
    await Promise.all([first, second]);

    // mitt 事件总线依赖单次注册：第二次 activate 被 activating 集合挡住。
    expect(deferred.activateFn).toHaveBeenCalledTimes(1);
    expect(statusOf('alpha')).toBe('active');
    expect(useExtensionStore.getState().widgets).toHaveLength(1);
    expect(useExtensionStore.getState().menuItems).toHaveLength(1);
  });
});
